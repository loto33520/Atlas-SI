from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuditEvent
from app.schemas import AuditEventRead
from app.security import AuthContext, require_access

router = APIRouter(prefix="/api/audit-events", tags=["Historique"])


@router.get("", response_model=list[AuditEventRead])
def list_audit_events(
    entity_type: str | None = None,
    entity_id: str | None = None,
    action: str | None = None,
    limit: int = Query(default=250, ge=1, le=2000),
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_access("auditor", "admin")),
):
    stmt = select(AuditEvent)
    if entity_type:
        stmt = stmt.where(AuditEvent.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditEvent.entity_id == entity_id)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    return list(db.scalars(stmt.order_by(AuditEvent.created_at.desc()).limit(limit)).all())
