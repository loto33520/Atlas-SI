from __future__ import annotations

import hmac
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import AuthSession

SESSION_COOKIE_NAME = "atlas_session"
TEMP_COOKIE_NAME = "atlas_oidc_tmp"
settings = get_settings()


@dataclass(frozen=True)
class AuthContext:
    session_id: str
    subject: str
    username: str
    email: str | None
    display_name: str
    roles: tuple[str, ...]
    groups: tuple[str, ...]
    csrf_token: str


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def get_auth_context(request: Request, db: Session = Depends(get_db)) -> AuthContext:
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentification requise.")

    auth_session = db.get(AuthSession, session_id)
    if not auth_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session inconnue ou expirée.")

    if _ensure_aware(auth_session.expires_at) <= utcnow():
        db.delete(auth_session)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expirée.")

    request.state.auth_session = auth_session
    return AuthContext(
        session_id=auth_session.id,
        subject=auth_session.subject,
        username=auth_session.username,
        email=auth_session.email,
        display_name=auth_session.display_name,
        roles=tuple(auth_session.app_roles),
        groups=tuple(auth_session.groups),
        csrf_token=auth_session.csrf_token,
    )


def require_access(*allowed_roles: str, csrf: bool = False) -> Callable:
    allowed = set(allowed_roles)

    def dependency(request: Request, context: AuthContext = Depends(get_auth_context)) -> AuthContext:
        if allowed and not allowed.intersection(context.roles):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Droits insuffisants.")

        if csrf:
            sent_token = request.headers.get("X-CSRF-Token", "")
            if not sent_token or not hmac.compare_digest(sent_token, context.csrf_token):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Jeton de protection invalide.")

            origin = request.headers.get("Origin")
            if origin and origin.rstrip("/") != settings.public_origin:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Origine de la requête refusée.")

        return context

    return dependency


def purge_expired_sessions(db: Session) -> int:
    result = db.execute(delete(AuthSession).where(AuthSession.expires_at <= utcnow()))
    db.commit()
    return int(result.rowcount or 0)


def map_application_roles(keycloak_roles: list[str], groups: list[str]) -> list[str]:
    candidates: set[str] = set()
    for value in [*keycloak_roles, *groups]:
        normalized = value.strip().casefold()
        if not normalized:
            continue
        candidates.add(normalized)
        candidates.add(normalized.rsplit("/", 1)[-1])

    mapped: set[str] = set()
    for app_role, accepted_values in settings.role_mappings.items():
        if candidates.intersection(accepted_values):
            mapped.add(app_role)

    if "admin" in mapped:
        mapped.update({"contributor", "auditor", "reader"})
    if "contributor" in mapped or "auditor" in mapped:
        mapped.add("reader")
    if not mapped and settings.allow_authenticated_read:
        mapped.add("reader")

    role_order = ["admin", "contributor", "auditor", "reader"]
    return [role for role in role_order if role in mapped]
