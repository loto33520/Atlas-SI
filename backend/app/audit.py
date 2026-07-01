from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from fastapi import Request
from sqlalchemy.inspection import inspect
from sqlalchemy.orm import Session

from app.models import AuditEvent
from app.security import AuthContext


def json_safe(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    return value


def model_snapshot(instance: Any) -> dict[str, Any]:
    mapper = inspect(instance).mapper
    return {
        column.key: json_safe(getattr(instance, column.key))
        for column in mapper.column_attrs
    }


def write_audit(
    db: Session,
    request: Request,
    actor: AuthContext,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> AuditEvent:
    forwarded = request.headers.get("X-Forwarded-For")
    source_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
    event = AuditEvent(
        actor_sub=actor.subject,
        actor_username=actor.username,
        actor_email=actor.email,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before=json_safe(before),
        after=json_safe(after),
        request_id=getattr(request.state, "request_id", None),
        source_ip=source_ip,
        user_agent=request.headers.get("User-Agent", "")[:512] or None,
    )
    db.add(event)
    return event
