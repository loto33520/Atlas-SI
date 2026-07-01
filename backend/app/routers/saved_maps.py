from __future__ import annotations

import csv
import io
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.audit import model_snapshot, write_audit
from app.database import get_db
from app.models import SavedMap
from app.schemas import APIMessage, SavedMapCreate, SavedMapRead, SavedMapUpdate
from app.security import AuthContext, require_access

router = APIRouter(prefix="/api/saved-maps", tags=["Cartes enregistrées"])


def _visible_stmt(actor: AuthContext):
    groups = list(actor.groups)
    clauses = [SavedMap.owner_sub == actor.subject, SavedMap.visibility == "all"]
    # Group visibility is filtered in Python because JSON overlap differs between SQLite and PostgreSQL.
    return select(SavedMap).where(SavedMap.active.is_(True), or_(*clauses, SavedMap.visibility == "groups")), groups


def _can_view(item: SavedMap, actor: AuthContext) -> bool:
    if item.owner_sub == actor.subject or item.visibility == "all":
        return True
    if item.visibility == "groups":
        actor_groups = {value.casefold() for value in actor.groups}
        allowed = {str(value).casefold() for value in (item.group_names or [])}
        return bool(actor_groups & allowed)
    return False


def _can_edit(item: SavedMap, actor: AuthContext) -> bool:
    return item.owner_sub == actor.subject or "admin" in actor.roles


@router.get("", response_model=list[SavedMapRead])
def list_maps(
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader")),
):
    stmt, _groups = _visible_stmt(actor)
    items = list(db.scalars(stmt.order_by(SavedMap.name)).all())
    return [item for item in items if _can_view(item, actor)]


@router.post("", response_model=SavedMapRead, status_code=201)
def create_map(
    payload: SavedMapCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader", csrf=True)),
):
    item = SavedMap(
        name=payload.name,
        description=payload.description,
        map_mode=payload.map_mode,
        visibility=payload.visibility,
        group_names=payload.group_names,
        owner_sub=actor.subject,
        owner_username=actor.username,
        root_object_ids=[str(value) for value in payload.root_object_ids],
        object_type_ids=[str(value) for value in payload.object_type_ids],
        relation_type_ids=[str(value) for value in payload.relation_type_ids],
        direction=payload.direction,
        max_depth=payload.max_depth,
        filters=payload.filters,
        layout_mode=payload.layout_mode,
        camera=payload.camera,
        positions=payload.positions,
        protection_level=payload.protection_level,
        snapshot=payload.snapshot if payload.map_mode == "snapshot" else {},
        active=True,
    )
    db.add(item)
    db.flush()
    write_audit(db, request, actor, action="create", entity_type="saved_map", entity_id=str(item.id), before=None, after=model_snapshot(item))
    db.commit()
    db.refresh(item)
    return item


@router.get("/{map_id}", response_model=SavedMapRead)
def read_map(
    map_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader")),
):
    item = db.get(SavedMap, map_id)
    if not item or not item.active or not _can_view(item, actor):
        raise HTTPException(status_code=404, detail="Carte enregistrée introuvable.")
    return item


@router.patch("/{map_id}", response_model=SavedMapRead)
def update_map(
    map_id: uuid.UUID,
    payload: SavedMapUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader", csrf=True)),
):
    item = db.get(SavedMap, map_id)
    if not item or not item.active or not _can_edit(item, actor):
        raise HTTPException(status_code=404, detail="Carte enregistrée introuvable.")
    before = model_snapshot(item)
    data = payload.model_dump(exclude_unset=True)
    for key in {"root_object_ids", "object_type_ids", "relation_type_ids"}:
        if key in data and data[key] is not None:
            data[key] = [str(value) for value in data[key]]
    for key, value in data.items():
        setattr(item, key, value)
    if item.map_mode != "snapshot":
        item.snapshot = {}
    db.flush()
    write_audit(db, request, actor, action="update", entity_type="saved_map", entity_id=str(item.id), before=before, after=model_snapshot(item))
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{map_id}", response_model=APIMessage)
def archive_map(
    map_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader", csrf=True)),
):
    item = db.get(SavedMap, map_id)
    if not item or not item.active or not _can_edit(item, actor):
        raise HTTPException(status_code=404, detail="Carte enregistrée introuvable.")
    before = model_snapshot(item)
    item.active = False
    db.flush()
    write_audit(db, request, actor, action="archive", entity_type="saved_map", entity_id=str(item.id), before=before, after=model_snapshot(item))
    db.commit()
    return APIMessage(message="Carte archivée.")


@router.get("/{map_id}/export")
def export_map(
    map_id: uuid.UUID,
    format: str = Query(default="json", pattern="^(json|objects_csv|relations_csv)$"),
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader")),
):
    item = db.get(SavedMap, map_id)
    if not item or not item.active or not _can_view(item, actor):
        raise HTTPException(status_code=404, detail="Carte enregistrée introuvable.")
    payload = model_snapshot(item)
    payload["id"] = str(item.id)
    filename = f"atlas-map-{item.id}"
    if format == "json":
        data = json.dumps(payload, ensure_ascii=False, indent=2, default=str).encode("utf-8")
        return StreamingResponse(io.BytesIO(data), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{filename}.json"'})

    snapshot = item.snapshot or {}
    graph = snapshot.get("graph", snapshot)
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    if format == "objects_csv":
        writer.writerow(["id", "type", "name", "status", "criticality", "owner", "protection"])
        for node in graph.get("nodes", []):
            writer.writerow([node.get("id"), node.get("object_type_name"), node.get("name"), node.get("status"), node.get("criticality"), node.get("owner_name"), node.get("protection_level")])
        suffix = "objects.csv"
    else:
        writer.writerow(["id", "source_id", "relation", "target_id", "label"])
        for edge in graph.get("edges", []):
            writer.writerow([edge.get("id"), edge.get("source_id"), edge.get("relation_type_name"), edge.get("target_id"), edge.get("label")])
        suffix = "relations.csv"
    data = output.getvalue().encode("utf-8-sig")
    return StreamingResponse(io.BytesIO(data), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}-{suffix}"'})
