from __future__ import annotations

import csv
import io
import ipaddress
import json
import os
import re
import socket
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import Connector, ConnectorRun, ObjectType, SIObject, VersionObservation

settings = get_settings()
ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
ALLOWED_STATUSES = {"up_to_date", "update_available", "unsupported", "exception", "unknown"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def calculate_compliance(
    *,
    observed_version: str | None,
    target_version: str | None,
    latest_version: str | None,
    support_end_date: date | None,
    exception_until: date | None,
    requested_status: str | None = None,
) -> str:
    today = utcnow().date()
    if exception_until and exception_until >= today:
        return "exception"
    if support_end_date and support_end_date < today:
        return "unsupported"
    if requested_status in ALLOWED_STATUSES and requested_status != "exception":
        return requested_status
    observed = (observed_version or "").strip()
    latest = (latest_version or "").strip()
    target = (target_version or "").strip()
    if observed and latest:
        return "up_to_date" if observed == latest else "update_available"
    if observed and target:
        return "up_to_date" if observed == target else "update_available"
    return "unknown"


def parse_date(value: Any) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value).strip()
    for candidate in (text, text[:10]):
        try:
            return date.fromisoformat(candidate)
        except ValueError:
            continue
    raise ValueError(f"Date invalide : {value}. Format attendu : AAAA-MM-JJ.")


def parse_datetime(value: Any) -> datetime:
    if value in (None, ""):
        return utcnow()
    if isinstance(value, datetime):
        result = value
    else:
        text = str(value).strip().replace("Z", "+00:00")
        try:
            result = datetime.fromisoformat(text)
        except ValueError as exc:
            raise ValueError(f"Date/heure invalide : {value}.") from exc
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result


def validate_connector_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise HTTPException(status_code=422, detail="Un connecteur doit utiliser une URL HTTPS valide.")
    allowed = settings.connector_allowed_host_list
    if allowed and parsed.hostname.casefold() not in allowed:
        raise HTTPException(status_code=422, detail="L’hôte du connecteur n’est pas présent dans CONNECTOR_ALLOWED_HOSTS.")


def _assert_public_host(hostname: str, *, allow_private: bool = False) -> None:
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise ValueError(f"Résolution DNS impossible pour {hostname}.") from exc
    for raw in addresses:
        ip = ipaddress.ip_address(raw)
        forbidden = ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified
        if forbidden or (ip.is_private and not allow_private):
            raise ValueError(f"L’adresse {ip} est refusée pour un connecteur HTTP.")


def _resolve_header_value(value: str) -> str:
    missing: list[str] = []

    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        resolved = os.getenv(name)
        if resolved is None:
            missing.append(name)
            return ""
        return resolved

    result = ENV_PATTERN.sub(replace, value)
    if missing:
        raise ValueError(f"Variable(s) d’environnement absente(s) : {', '.join(sorted(set(missing)))}.")
    return result


def fetch_connector_content(connector: Connector) -> str:
    validate_connector_url(connector.url)
    hostname = urlparse(connector.url).hostname or ""
    _assert_public_host(hostname, allow_private=hostname.casefold() in settings.connector_allowed_host_list)
    headers = {str(key): _resolve_header_value(str(value)) for key, value in connector.headers.items()}
    headers.setdefault("Accept", "application/json,text/csv;q=0.9,*/*;q=0.5")
    headers.setdefault("User-Agent", f"Atlas-SI/{settings.app_version}")
    request = urllib.request.Request(connector.url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=settings.connector_http_timeout_seconds) as response:
        length = int(response.headers.get("Content-Length", "0") or 0)
        if length > settings.connector_max_response_bytes:
            raise ValueError("La réponse dépasse la taille maximale autorisée.")
        raw = response.read(settings.connector_max_response_bytes + 1)
        if len(raw) > settings.connector_max_response_bytes:
            raise ValueError("La réponse dépasse la taille maximale autorisée.")
        charset = response.headers.get_content_charset() or "utf-8"
        return raw.decode(charset)


def parse_rows(content: str, source_format: str) -> list[dict[str, Any]]:
    if source_format == "json":
        payload = json.loads(content)
        if isinstance(payload, dict):
            for key in ("items", "data", "results", "versions"):
                if isinstance(payload.get(key), list):
                    payload = payload[key]
                    break
        if not isinstance(payload, list):
            raise ValueError("Le JSON doit contenir une liste ou une clé items/data/results/versions.")
        rows = payload
    else:
        rows = list(csv.DictReader(io.StringIO(content)))
    if len(rows) > settings.connector_max_rows:
        raise ValueError(f"Le connecteur dépasse la limite de {settings.connector_max_rows} lignes.")
    if not all(isinstance(item, dict) for item in rows):
        raise ValueError("Chaque ligne doit être un objet clé/valeur.")
    return [dict(item) for item in rows]


def _mapped(row: dict[str, Any], mapping: dict[str, Any], canonical: str) -> Any:
    source = str(mapping.get(canonical) or canonical)
    return row.get(source)


def resolve_object(db: Session, row: dict[str, Any], mapping: dict[str, Any]) -> SIObject | None:
    reference = str(_mapped(row, mapping, "object_ref") or _mapped(row, mapping, "external_id") or "").strip()
    name = str(_mapped(row, mapping, "object_name") or _mapped(row, mapping, "name") or "").strip()
    type_ref = str(_mapped(row, mapping, "object_type") or "").strip()
    stmt = select(SIObject).join(ObjectType).where(SIObject.active.is_(True))
    if reference:
        stmt = stmt.where(SIObject.external_id == reference)
    elif name:
        stmt = stmt.where(func.lower(SIObject.name) == name.casefold())
    else:
        return None
    if type_ref:
        stmt = stmt.where(or_(func.lower(ObjectType.code) == type_ref.casefold(), func.lower(ObjectType.name) == type_ref.casefold()))
    matches = list(db.scalars(stmt.limit(3)).all())
    if len(matches) > 1:
        raise ValueError(f"Objet ambigu : {reference or name}.")
    return matches[0] if matches else None


def execute_connector(
    db: Session,
    connector: Connector,
    *,
    actor_sub: str,
    actor_username: str,
    triggered_by: str = "manual",
    dry_run: bool = False,
    content_override: str | None = None,
) -> ConnectorRun:
    now = utcnow()
    run = ConnectorRun(
        connector_id=connector.id,
        status="running",
        triggered_by=triggered_by,
        actor_sub=actor_sub,
        actor_username=actor_username,
        summary={},
    )
    db.add(run)
    db.flush()
    summary = {"rows": 0, "created": 0, "skipped": 0, "errors": 0, "dry_run": dry_run}
    messages: list[str] = []
    try:
        content = content_override if content_override is not None else fetch_connector_content(connector)
        rows = parse_rows(content, connector.source_format)
        summary["rows"] = len(rows)
        for index, row in enumerate(rows, start=1):
            try:
                obj = resolve_object(db, row, connector.mapping)
                if not obj:
                    summary["skipped"] += 1
                    messages.append(f"Ligne {index}: objet introuvable.")
                    continue
                observed_version = str(_mapped(row, connector.mapping, "observed_version") or "").strip() or None
                target_version = str(_mapped(row, connector.mapping, "target_version") or "").strip() or None
                latest_version = str(_mapped(row, connector.mapping, "latest_version") or "").strip() or None
                support_end_date = parse_date(_mapped(row, connector.mapping, "support_end_date"))
                exception_until = parse_date(_mapped(row, connector.mapping, "exception_until"))
                observed_at = parse_datetime(_mapped(row, connector.mapping, "observed_at"))
                status = calculate_compliance(
                    observed_version=observed_version,
                    target_version=target_version,
                    latest_version=latest_version,
                    support_end_date=support_end_date,
                    exception_until=exception_until,
                    requested_status=str(_mapped(row, connector.mapping, "compliance_status") or "").strip() or None,
                )
                if not dry_run:
                    observation = VersionObservation(
                        object_id=obj.id,
                        observed_version=observed_version,
                        target_version=target_version,
                        latest_version=latest_version,
                        support_end_date=support_end_date,
                        observed_at=observed_at,
                        source=connector.name,
                        source_reference=str(_mapped(row, connector.mapping, "source_reference") or connector.url)[:255],
                        compliance_status=status,
                        exception_until=exception_until,
                        notes=str(_mapped(row, connector.mapping, "notes") or "").strip() or None,
                        details={"connector_row": index},
                        connector_run_id=run.id,
                        actor_sub=actor_sub,
                        actor_username=actor_username,
                    )
                    db.add(observation)
                summary["created"] += 1
            except Exception as exc:  # une ligne invalide ne bloque pas tout le flux
                summary["errors"] += 1
                messages.append(f"Ligne {index}: {exc}")
        run.status = "preview" if dry_run else ("partial" if summary["errors"] else "success")
        run.message = "\n".join(messages[:50]) or None
    except Exception as exc:
        run.status = "failed"
        run.message = str(exc)
        summary["errors"] += 1
    finally:
        run.finished_at = utcnow()
        run.summary = summary
        connector.last_run_at = run.finished_at
        connector.last_status = run.status
        connector.last_message = run.message
        connector.next_run_at = run.finished_at + timedelta(minutes=connector.schedule_minutes) if connector.enabled else None
        db.commit()
        db.refresh(run)
    return run
