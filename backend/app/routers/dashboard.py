from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuditEvent, ObjectType, RelationType, SIObject, SIRelation
from app.schemas import DashboardRead
from app.security import AuthContext, require_access, utcnow

router = APIRouter(prefix="/api/dashboard", tags=["Tableau de bord"])


@router.get("", response_model=DashboardRead)
def dashboard(
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_access("reader")),
):
    def count_active(model) -> int:
        return int(db.scalar(select(func.count()).select_from(model).where(model.active.is_(True))) or 0)

    recent = int(
        db.scalar(
            select(func.count()).select_from(AuditEvent).where(AuditEvent.created_at >= utcnow() - timedelta(days=7))
        )
        or 0
    )
    return DashboardRead(
        object_types=count_active(ObjectType),
        relation_types=count_active(RelationType),
        objects=count_active(SIObject),
        relations=count_active(SIRelation),
        recent_audit_events=recent,
    )
