from __future__ import annotations

import uuid
from collections import Counter
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.audit import model_snapshot, write_audit
from app.database import get_db
from app.models import SIObject, VersionObservation
from app.schemas import (
    APIMessage,
    VersionCurrentRead,
    VersionObservationCreate,
    VersionObservationRead,
    VersionObservationUpdate,
    VersionSummaryRead,
)
from app.security import AuthContext, require_access
from app.versioning import calculate_compliance, utcnow

router = APIRouter(prefix="/api/versions", tags=["Versions"])


def _current_rows(db: Session) -> list[VersionObservation]:
    rows = list(db.scalars(
        select(VersionObservation)
        .options(selectinload(VersionObservation.object).selectinload(SIObject.object_type))
        .where(VersionObservation.active.is_(True), SIObject.active.is_(True))
        .join(VersionObservation.object)
        .order_by(VersionObservation.object_id, VersionObservation.observed_at.desc(), VersionObservation.created_at.desc())
    ).unique().all())
    current: dict[uuid.UUID, VersionObservation] = {}
    for row in rows:
        current.setdefault(row.object_id, row)
    return list(current.values())


def _current_read(row: VersionObservation) -> dict:
    return {
        **model_snapshot(row),
        "object_name": row.object.name,
        "object_type_name": row.object.object_type.name,
        "owner_name": row.object.owner_name,
        "criticality": row.object.criticality,
    }


@router.get("/current", response_model=list[VersionCurrentRead])
def list_current_versions(
    q: str = "",
    status: str = "",
    object_type_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    _actor: AuthContext = Depends(require_access("reader")),
):
    rows = _current_rows(db)
    query = q.strip().casefold()
    result = []
    for row in rows:
        if status and row.compliance_status != status:
            continue
        if object_type_id and row.object.object_type_id != object_type_id:
            continue
        if query and query not in row.object.name.casefold() and query not in (row.observed_version or "").casefold():
            continue
        result.append(_current_read(row))
    return sorted(result, key=lambda item: (item["compliance_status"], item["object_name"].casefold()))


@router.get("/summary", response_model=VersionSummaryRead)
def version_summary(
    db: Session = Depends(get_db),
    _actor: AuthContext = Depends(require_access("reader")),
):
    rows = _current_rows(db)
    counts = Counter(row.compliance_status for row in rows)
    deadline = utcnow().date() + timedelta(days=90)
    expiring = sum(1 for row in rows if row.support_end_date and utcnow().date() <= row.support_end_date <= deadline)
    return {
        "total": len(rows),
        "by_status": dict(counts),
        "unsupported": counts["unsupported"],
        "update_available": counts["update_available"],
        "up_to_date": counts["up_to_date"],
        "unknown": counts["unknown"],
        "exceptions": counts["exception"],
        "expiring_within_90_days": expiring,
    }


@router.get("/observations", response_model=list[VersionObservationRead])
def list_observations(
    object_id: uuid.UUID | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    _actor: AuthContext = Depends(require_access("reader")),
):
    stmt = select(VersionObservation).where(VersionObservation.active.is_(True))
    if object_id:
        stmt = stmt.where(VersionObservation.object_id == object_id)
    return list(db.scalars(stmt.order_by(VersionObservation.observed_at.desc()).limit(limit)).all())


@router.post("/observations", response_model=VersionObservationRead, status_code=201)
def create_observation(
    payload: VersionObservationCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", "contributor", csrf=True)),
):
    obj = db.get(SIObject, payload.object_id)
    if not obj or not obj.active:
        raise HTTPException(status_code=404, detail="Objet introuvable ou archivé.")
    values = payload.model_dump()
    values["observed_at"] = values["observed_at"] or utcnow()
    values["compliance_status"] = calculate_compliance(
        observed_version=values["observed_version"],
        target_version=values["target_version"],
        latest_version=values["latest_version"],
        support_end_date=values["support_end_date"],
        exception_until=values["exception_until"],
        requested_status=values["compliance_status"],
    )
    item = VersionObservation(**values, actor_sub=actor.subject, actor_username=actor.username)
    db.add(item)
    db.flush()
    write_audit(db, request, actor, action="create", entity_type="version_observation", entity_id=str(item.id), before=None, after=model_snapshot(item))
    db.commit()
    db.refresh(item)
    return item


@router.patch("/observations/{observation_id}", response_model=VersionObservationRead)
def update_observation(
    observation_id: uuid.UUID,
    payload: VersionObservationUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", "contributor", csrf=True)),
):
    item = db.get(VersionObservation, observation_id)
    if not item or not item.active:
        raise HTTPException(status_code=404, detail="Observation introuvable.")
    before = model_snapshot(item)
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(item, key, value)
    item.compliance_status = calculate_compliance(
        observed_version=item.observed_version,
        target_version=item.target_version,
        latest_version=item.latest_version,
        support_end_date=item.support_end_date,
        exception_until=item.exception_until,
        requested_status=changes.get("compliance_status", item.compliance_status),
    )
    write_audit(db, request, actor, action="update", entity_type="version_observation", entity_id=str(item.id), before=before, after=model_snapshot(item))
    db.commit()
    db.refresh(item)
    return item


@router.delete("/observations/{observation_id}", response_model=APIMessage)
def archive_observation(
    observation_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", "contributor", csrf=True)),
):
    item = db.get(VersionObservation, observation_id)
    if not item or not item.active:
        raise HTTPException(status_code=404, detail="Observation introuvable.")
    before = model_snapshot(item)
    item.active = False
    write_audit(db, request, actor, action="archive", entity_type="version_observation", entity_id=str(item.id), before=before, after=model_snapshot(item))
    db.commit()
    return {"message": "Observation archivée."}
