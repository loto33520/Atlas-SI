import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import model_snapshot, write_audit
from app.database import get_db
from app.models import ObjectType, RelationType, SIObject, SIRelation
from app.schemas import APIMessage, SIObjectCreate, SIObjectRead, SIObjectUpdate
from app.security import AuthContext, require_access

router = APIRouter(prefix="/api/objects", tags=["Objets du SI"])


def _get_or_404(db: Session, item_id: uuid.UUID) -> SIObject:
    item = db.get(SIObject, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Objet du SI introuvable.")
    return item


def _check_object_type(db: Session, object_type_id: uuid.UUID) -> None:
    object_type = db.get(ObjectType, object_type_id)
    if not object_type or not object_type.active:
        raise HTTPException(status_code=422, detail="Le type d'objet sélectionné n'existe pas ou est archivé.")


def validate_object_attributes(db: Session, object_type_id: uuid.UUID, attributes: dict) -> None:
    object_type = db.get(ObjectType, object_type_id)
    if not object_type or not object_type.active:
        raise HTTPException(status_code=422, detail="Le type d'objet sélectionné n'existe pas ou est archivé.")
    fields = (object_type.schema or {}).get("fields", [])
    if not isinstance(fields, list):
        return
    for field in fields:
        if not isinstance(field, dict):
            continue
        key = str(field.get("key", "")).strip()
        if not key:
            continue
        value = attributes.get(key)
        if field.get("required") and (value is None or value == ""):
            raise HTTPException(status_code=422, detail=f"Le champ « {field.get('label') or key} » est obligatoire.")
        if value is None or value == "":
            continue
        field_type = field.get("type", "text")
        if field_type == "number" and not isinstance(value, (int, float)):
            raise HTTPException(status_code=422, detail=f"Le champ « {field.get('label') or key} » doit être un nombre.")
        if field_type == "boolean" and not isinstance(value, bool):
            raise HTTPException(status_code=422, detail=f"Le champ « {field.get('label') or key} » doit être Oui ou Non.")
        if field_type == "select":
            options = field.get("options", [])
            if isinstance(options, list) and options and str(value) not in {str(item) for item in options}:
                raise HTTPException(status_code=422, detail=f"La valeur du champ « {field.get('label') or key} » n'est pas autorisée.")


def _validate_type_change(db: Session, item: SIObject, new_type_id: uuid.UUID) -> None:
    outgoing = db.scalars(
        select(SIRelation).where(
            SIRelation.source_id == item.id,
            SIRelation.active.is_(True),
        )
    ).all()
    for relation in outgoing:
        relation_type = db.get(RelationType, relation.relation_type_id)
        if relation_type and relation_type.source_type_id and relation_type.source_type_id != new_type_id:
            raise HTTPException(
                status_code=409,
                detail="Ce changement de type invaliderait une relation sortante existante.",
            )

    incoming = db.scalars(
        select(SIRelation).where(
            SIRelation.target_id == item.id,
            SIRelation.active.is_(True),
        )
    ).all()
    for relation in incoming:
        relation_type = db.get(RelationType, relation.relation_type_id)
        if relation_type and relation_type.target_type_id and relation_type.target_type_id != new_type_id:
            raise HTTPException(
                status_code=409,
                detail="Ce changement de type invaliderait une relation entrante existante.",
            )


@router.get("", response_model=list[SIObjectRead])
def list_objects(
    q: str | None = None,
    object_type_id: uuid.UUID | None = None,
    status_value: str | None = Query(default=None, alias="status"),
    criticality: str | None = None,
    include_inactive: bool = False,
    limit: int = Query(default=500, ge=1, le=2000),
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_access("reader")),
):
    stmt = select(SIObject)
    if not include_inactive:
        stmt = stmt.where(SIObject.active.is_(True))
    if object_type_id:
        stmt = stmt.where(SIObject.object_type_id == object_type_id)
    if status_value:
        stmt = stmt.where(SIObject.status == status_value)
    if criticality:
        stmt = stmt.where(SIObject.criticality == criticality)
    if q:
        pattern = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                SIObject.name.ilike(pattern),
                SIObject.external_id.ilike(pattern),
                SIObject.owner_name.ilike(pattern),
            )
        )
    return list(db.scalars(stmt.order_by(SIObject.name).limit(limit)).all())


@router.get("/{item_id}", response_model=SIObjectRead)
def read_object(
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_access("reader")),
):
    return _get_or_404(db, item_id)


@router.post("", response_model=SIObjectRead, status_code=status.HTTP_201_CREATED)
def create_object(
    payload: SIObjectCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("contributor", "admin", csrf=True)),
):
    _check_object_type(db, payload.object_type_id)
    validate_object_attributes(db, payload.object_type_id, payload.attributes)
    item = SIObject(**payload.model_dump())
    db.add(item)
    try:
        db.flush()
        write_audit(
            db, request, actor, action="create", entity_type="si_object", entity_id=str(item.id), before=None, after=model_snapshot(item)
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="L'identifiant externe est déjà utilisé.") from exc
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=SIObjectRead)
def update_object(
    item_id: uuid.UUID,
    payload: SIObjectUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("contributor", "admin", csrf=True)),
):
    item = _get_or_404(db, item_id)
    changes = payload.model_dump(exclude_unset=True)
    if "object_type_id" in changes and changes["object_type_id"] is not None:
        _check_object_type(db, changes["object_type_id"])
        if changes["object_type_id"] != item.object_type_id:
            _validate_type_change(db, item, changes["object_type_id"])
    final_type_id = changes.get("object_type_id", item.object_type_id)
    final_attributes = changes.get("attributes", item.attributes)
    validate_object_attributes(db, final_type_id, final_attributes)
    before = model_snapshot(item)
    for key, value in changes.items():
        setattr(item, key, value)
    try:
        db.flush()
        write_audit(
            db, request, actor, action="update", entity_type="si_object", entity_id=str(item.id), before=before, after=model_snapshot(item)
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="L'identifiant externe est déjà utilisé.") from exc
    db.refresh(item)
    return item


@router.delete("/{item_id}", response_model=APIMessage)
def archive_object(
    item_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("contributor", "admin", csrf=True)),
):
    item = _get_or_404(db, item_id)
    before = model_snapshot(item)
    item.active = False
    for relation in [*item.outgoing_relations, *item.incoming_relations]:
        if not relation.active:
            continue
        relation_before = model_snapshot(relation)
        relation.active = False
        db.flush()
        write_audit(
            db,
            request,
            actor,
            action="archive_cascade",
            entity_type="si_relation",
            entity_id=str(relation.id),
            before=relation_before,
            after=model_snapshot(relation),
        )
    db.flush()
    write_audit(
        db, request, actor, action="archive", entity_type="si_object", entity_id=str(item.id), before=before, after=model_snapshot(item)
    )
    db.commit()
    return APIMessage(message="Objet du SI et relations associées archivés.")
