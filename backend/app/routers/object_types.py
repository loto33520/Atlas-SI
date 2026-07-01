import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import model_snapshot, write_audit
from app.database import get_db
from app.models import ObjectType, SIObject
from app.schemas import APIMessage, ObjectTypeCreate, ObjectTypeRead, ObjectTypeUpdate
from app.security import AuthContext, require_access

router = APIRouter(prefix="/api/object-types", tags=["Types d'objets"])


def _get_or_404(db: Session, item_id: uuid.UUID) -> ObjectType:
    item = db.get(ObjectType, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Type d'objet introuvable.")
    return item


def _active_usage_count(db: Session, item_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count()).select_from(SIObject).where(
                SIObject.object_type_id == item_id,
                SIObject.active.is_(True),
            )
        )
        or 0
    )


def _ensure_not_used(db: Session, item: ObjectType) -> None:
    count = _active_usage_count(db, item.id)
    if count:
        raise HTTPException(
            status_code=409,
            detail=f"Ce type est encore utilisé par {count} objet(s) actif(s). Archive d'abord ces objets.",
        )


@router.get("", response_model=list[ObjectTypeRead])
def list_object_types(
    q: str | None = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_access("reader")),
):
    stmt = select(ObjectType)
    if not include_inactive:
        stmt = stmt.where(ObjectType.active.is_(True))
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(or_(ObjectType.name.ilike(pattern), ObjectType.code.ilike(pattern)))
    items = list(db.scalars(stmt.order_by(ObjectType.name)).all())
    if not items:
        return []
    ids = [item.id for item in items]
    total_counts = dict(db.execute(
        select(SIObject.object_type_id, func.count(SIObject.id))
        .where(SIObject.object_type_id.in_(ids))
        .group_by(SIObject.object_type_id)
    ).all())
    active_counts = dict(db.execute(
        select(SIObject.object_type_id, func.count(SIObject.id))
        .where(SIObject.object_type_id.in_(ids), SIObject.active.is_(True))
        .group_by(SIObject.object_type_id)
    ).all())
    for item in items:
        item.object_count = int(total_counts.get(item.id, 0))
        item.active_object_count = int(active_counts.get(item.id, 0))
    return items


@router.post("", response_model=ObjectTypeRead, status_code=status.HTTP_201_CREATED)
def create_object_type(
    payload: ObjectTypeCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", csrf=True)),
):
    item = ObjectType(**payload.model_dump(by_alias=True))
    db.add(item)
    try:
        db.flush()
        write_audit(
            db, request, actor, action="create", entity_type="object_type", entity_id=str(item.id), before=None, after=model_snapshot(item)
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Ce code de type d'objet existe déjà.") from exc
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ObjectTypeRead)
def update_object_type(
    item_id: uuid.UUID,
    payload: ObjectTypeUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", csrf=True)),
):
    item = _get_or_404(db, item_id)
    before = model_snapshot(item)
    changes = payload.model_dump(exclude_unset=True, by_alias=True)
    if changes.get("active") is False and item.active:
        _ensure_not_used(db, item)
    for key, value in changes.items():
        setattr(item, key, value)
    try:
        db.flush()
        write_audit(
            db, request, actor, action="update", entity_type="object_type", entity_id=str(item.id), before=before, after=model_snapshot(item)
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Le code demandé est déjà utilisé.") from exc
    db.refresh(item)
    return item


@router.delete("/{item_id}", response_model=APIMessage)
def archive_object_type(
    item_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", csrf=True)),
):
    item = _get_or_404(db, item_id)
    _ensure_not_used(db, item)
    before = model_snapshot(item)
    item.active = False
    db.flush()
    write_audit(
        db, request, actor, action="archive", entity_type="object_type", entity_id=str(item.id), before=before, after=model_snapshot(item)
    )
    db.commit()
    return APIMessage(message="Type d'objet archivé.")
