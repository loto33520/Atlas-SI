from __future__ import annotations

import base64
import hashlib
import hmac
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock

from fastapi import Request

_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SALT_BYTES = 16
_DKLEN = 32


def hash_password(password: str) -> str:
    salt = os.urandom(_SALT_BYTES)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_DKLEN,
    )
    return "scrypt${}${}${}${}${}".format(
        _SCRYPT_N,
        _SCRYPT_R,
        _SCRYPT_P,
        base64.urlsafe_b64encode(salt).decode("ascii").rstrip("="),
        base64.urlsafe_b64encode(digest).decode("ascii").rstrip("="),
    )


def _decode_b64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n_raw, r_raw, p_raw, salt_raw, expected_raw = encoded.split("$", 5)
        if algorithm != "scrypt":
            return False
        n, r, p = int(n_raw), int(r_raw), int(p_raw)
        if n > 2**18 or r > 32 or p > 8:
            return False
        salt = _decode_b64(salt_raw)
        expected = _decode_b64(expected_raw)
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=len(expected),
        )
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError, MemoryError):
        return False


def source_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


@dataclass
class AttemptState:
    failures: list[datetime]
    blocked_until: datetime | None = None


class LocalLoginLimiter:
    """Limiteur simple adapté au déploiement mono-processus d'Atlas SI."""

    def __init__(self) -> None:
        self._states: dict[str, AttemptState] = {}
        self._lock = Lock()

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)

    def _key(self, request: Request, username: str) -> str:
        return f"{source_ip(request)}|{username.casefold()}"

    def remaining_block_seconds(self, request: Request, username: str, *, window_seconds: int) -> int:
        key = self._key(request, username)
        now = self._now()
        with self._lock:
            state = self._states.get(key)
            if not state or not state.blocked_until:
                return 0
            if state.blocked_until <= now:
                self._states.pop(key, None)
                return 0
            return max(1, int((state.blocked_until - now).total_seconds()))

    def fail(self, request: Request, username: str, *, max_attempts: int, window_seconds: int) -> int:
        key = self._key(request, username)
        now = self._now()
        cutoff = now - timedelta(seconds=window_seconds)
        with self._lock:
            state = self._states.setdefault(key, AttemptState(failures=[]))
            state.failures = [item for item in state.failures if item >= cutoff]
            state.failures.append(now)
            if len(state.failures) >= max_attempts:
                state.blocked_until = now + timedelta(seconds=window_seconds)
                return window_seconds
            return 0

    def success(self, request: Request, username: str) -> None:
        with self._lock:
            self._states.pop(self._key(request, username), None)


login_limiter = LocalLoginLimiter()
