import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import model_snapshot, write_audit
from app.database import get_db
from app.models import ObjectType, RelationType, SIRelation
from app.schemas import APIMessage, RelationTypeCreate, RelationTypeRead, RelationTypeUpdate
from app.security import AuthContext, require_access

router = APIRouter(prefix="/api/relation-types", tags=["Types de relations"])


def _get_or_404(db: Session, item_id: uuid.UUID) -> RelationType:
    item = db.get(RelationType, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Type de relation introuvable.")
    return item


def _active_usage_count(db: Session, item_id: uuid.UUID) -> int:
    return int(
        db.scalar(
            select(func.count()).select_from(SIRelation).where(
                SIRelation.relation_type_id == item_id,
                SIRelation.active.is_(True),
            )
        )
        or 0
    )


def _ensure_not_used(db: Session, item: RelationType) -> None:
    count = _active_usage_count(db, item.id)
    if count:
        raise HTTPException(
            status_code=409,
            detail=f"Ce type est encore utilisé par {count} relation(s) active(s). Archive d'abord ces relations.",
        )


def _validate_existing_relations(
    db: Session,
    item: RelationType,
    source_type_id: uuid.UUID | None,
    target_type_id: uuid.UUID | None,
) -> None:
    relations = db.scalars(
        select(SIRelation).where(
            SIRelation.relation_type_id == item.id,
            SIRelation.active.is_(True),
        )
    ).all()
    for relation in relations:
        if source_type_id and relation.source.object_type_id != source_type_id:
            raise HTTPException(
                status_code=409,
                detail="La nouvelle contrainte source invaliderait des relations existantes.",
            )
        if target_type_id and relation.target.object_type_id != target_type_id:
            raise HTTPException(
                status_code=409,
                detail="La nouvelle contrainte cible invaliderait des relations existantes.",
            )


def _check_object_type(db: Session, item_id: uuid.UUID | None) -> None:
    if item_id is not None and db.get(ObjectType, item_id) is None:
        raise HTTPException(status_code=422, detail="Le type d'objet référencé n'existe pas.")


@router.get("", response_model=list[RelationTypeRead])
def list_relation_types(
    q: str | None = None,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_access("reader")),
):
    stmt = select(RelationType)
    if not include_inactive:
        stmt = stmt.where(RelationType.active.is_(True))
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(or_(RelationType.name.ilike(pattern), RelationType.code.ilike(pattern)))
    return list(db.scalars(stmt.order_by(RelationType.name)).all())


@router.post("", response_model=RelationTypeRead, status_code=status.HTTP_201_CREATED)
def create_relation_type(
    payload: RelationTypeCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", csrf=True)),
):
    _check_object_type(db, payload.source_type_id)
    _check_object_type(db, payload.target_type_id)
    item = RelationType(**payload.model_dump())
    db.add(item)
    try:
        db.flush()
        write_audit(
            db, request, actor, action="create", entity_type="relation_type", entity_id=str(item.id), before=None, after=model_snapshot(item)
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Ce code de type de relation existe déjà.") from exc
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=RelationTypeRead)
def update_relation_type(
    item_id: uuid.UUID,
    payload: RelationTypeUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", csrf=True)),
):
    item = _get_or_404(db, item_id)
    changes = payload.model_dump(exclude_unset=True)
    if "source_type_id" in changes:
        _check_object_type(db, changes["source_type_id"])
    if "target_type_id" in changes:
        _check_object_type(db, changes["target_type_id"])
    if changes.get("active") is False and item.active:
        _ensure_not_used(db, item)
    _validate_existing_relations(
        db,
        item,
        changes.get("source_type_id", item.source_type_id),
        changes.get("target_type_id", item.target_type_id),
    )
    before = model_snapshot(item)
    for key, value in changes.items():
        setattr(item, key, value)
    try:
        db.flush()
        write_audit(
            db, request, actor, action="update", entity_type="relation_type", entity_id=str(item.id), before=before, after=model_snapshot(item)
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Le code demandé est déjà utilisé.") from exc
    db.refresh(item)
    return item


@router.delete("/{item_id}", response_model=APIMessage)
def archive_relation_type(
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
        db, request, actor, action="archive", entity_type="relation_type", entity_id=str(item.id), before=before, after=model_snapshot(item)
    )
    db.commit()
    return APIMessage(message="Type de relation archivé.")
