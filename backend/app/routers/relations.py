import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import model_snapshot, write_audit
from app.database import get_db
from app.models import RelationType, SIObject, SIRelation
from app.schemas import APIMessage, SIRelationCreate, SIRelationRead, SIRelationUpdate
from app.security import AuthContext, require_access

router = APIRouter(prefix="/api/relations", tags=["Relations"])


def _get_or_404(db: Session, item_id: uuid.UUID) -> SIRelation:
    item = db.get(SIRelation, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Relation introuvable.")
    return item


def _validate_relation(
    db: Session,
    relation_type_id: uuid.UUID,
    source_id: uuid.UUID,
    target_id: uuid.UUID,
) -> None:
    if source_id == target_id:
        raise HTTPException(status_code=422, detail="Une relation ne peut pas relier un objet à lui-même.")
    relation_type = db.get(RelationType, relation_type_id)
    source = db.get(SIObject, source_id)
    target = db.get(SIObject, target_id)
    if not relation_type or not relation_type.active:
        raise HTTPException(status_code=422, detail="Le type de relation n'existe pas ou est archivé.")
    if not source or not source.active or not target or not target.active:
        raise HTTPException(status_code=422, detail="La source ou la cible n'existe pas ou est archivée.")
    if relation_type.source_type_id and source.object_type_id != relation_type.source_type_id:
        raise HTTPException(status_code=422, detail="Le type de l'objet source ne correspond pas à cette relation.")
    if relation_type.target_type_id and target.object_type_id != relation_type.target_type_id:
        raise HTTPException(status_code=422, detail="Le type de l'objet cible ne correspond pas à cette relation.")


@router.get("", response_model=list[SIRelationRead])
def list_relations(
    object_id: uuid.UUID | None = None,
    relation_type_id: uuid.UUID | None = None,
    include_inactive: bool = False,
    limit: int = Query(default=1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_access("reader")),
):
    stmt = select(SIRelation)
    if not include_inactive:
        stmt = stmt.where(SIRelation.active.is_(True))
    if object_id:
        stmt = stmt.where((SIRelation.source_id == object_id) | (SIRelation.target_id == object_id))
    if relation_type_id:
        stmt = stmt.where(SIRelation.relation_type_id == relation_type_id)
    return list(db.scalars(stmt.order_by(SIRelation.created_at.desc()).limit(limit)).all())


@router.post("", response_model=SIRelationRead, status_code=status.HTTP_201_CREATED)
def create_relation(
    payload: SIRelationCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("contributor", "admin", csrf=True)),
):
    _validate_relation(db, payload.relation_type_id, payload.source_id, payload.target_id)
    item = SIRelation(**payload.model_dump())
    db.add(item)
    try:
        db.flush()
        write_audit(
            db, request, actor, action="create", entity_type="si_relation", entity_id=str(item.id), before=None, after=model_snapshot(item)
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cette relation existe déjà.") from exc
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=SIRelationRead)
def update_relation(
    item_id: uuid.UUID,
    payload: SIRelationUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("contributor", "admin", csrf=True)),
):
    item = _get_or_404(db, item_id)
    changes = payload.model_dump(exclude_unset=True)
    relation_type_id = changes.get("relation_type_id", item.relation_type_id)
    source_id = changes.get("source_id", item.source_id)
    target_id = changes.get("target_id", item.target_id)
    _validate_relation(db, relation_type_id, source_id, target_id)
    before = model_snapshot(item)
    for key, value in changes.items():
        setattr(item, key, value)
    try:
        db.flush()
        write_audit(
            db, request, actor, action="update", entity_type="si_relation", entity_id=str(item.id), before=before, after=model_snapshot(item)
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Cette relation existe déjà.") from exc
    db.refresh(item)
    return item


@router.delete("/{item_id}", response_model=APIMessage)
def archive_relation(
    item_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("contributor", "admin", csrf=True)),
):
    item = _get_or_404(db, item_id)
    before = model_snapshot(item)
    item.active = False
    db.flush()
    write_audit(
        db, request, actor, action="archive", entity_type="si_relation", entity_id=str(item.id), before=before, after=model_snapshot(item)
    )
    db.commit()
    return APIMessage(message="Relation archivée.")
