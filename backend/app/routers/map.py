from __future__ import annotations

import uuid
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.database import get_db
from app.models import MapPosition, ObjectType, RelationType, SIObject, SIRelation
from app.schemas import (
    APIMessage,
    MapCatalogRead,
    MapGraphRead,
    MapPositionsUpdate,
    MapPreviewRead,
    MapQueryRequest,
)
from app.security import AuthContext, require_access

router = APIRouter(prefix="/api/map", tags=["Cartographie"])
settings = get_settings()

VIEW_TYPE_CODES: dict[str, set[str] | None] = {
    "all": None,
    "process": {"process", "application", "data"},
    "application": {"application", "database", "software", "data", "server"},
    "infrastructure": {"site", "building", "room", "rack", "physical_server", "server", "database", "software", "network", "network_zone", "vlan", "subnet", "firewall", "storage", "telecom_link"},
    "data": {"data", "database", "application", "process"},
    "administration": {"admin_profile", "privileged_account", "bastion", "admin_workstation", "server", "application"},
    "ecosystem": {"organisation", "supplier", "saas_service", "contract", "application", "data"},
}


def _normalise_view(view: str) -> str:
    value = view.strip().lower()
    if value not in VIEW_TYPE_CODES:
        raise HTTPException(status_code=422, detail="Vue cartographique inconnue.")
    return value


def _parse_tag_filters(raw_filters: list[str]) -> list[tuple[str, str]]:
    parsed: list[tuple[str, str]] = []
    for raw in raw_filters:
        if ":" not in raw:
            raise HTTPException(status_code=422, detail="Une étiquette doit utiliser le format clé:valeur.")
        key, value = raw.split(":", 1)
        key, value = key.strip().casefold(), value.strip().casefold()
        if not key or not value:
            raise HTTPException(status_code=422, detail="Une étiquette doit utiliser le format clé:valeur.")
        parsed.append((key, value))
    return parsed


def _matches_tags(item: SIObject, filters: list[tuple[str, str]]) -> bool:
    tags = {str(key).casefold(): str(value).casefold() for key, value in (item.tags or {}).items()}
    return all(tags.get(key) == value for key, value in filters)


def _serialise_graph(
    db: Session,
    objects: list[SIObject],
    relations: list[SIRelation],
    *,
    view: str,
    user_sub: str,
    position_view_key: str,
    total_nodes: int | None = None,
    truncated: bool = False,
) -> dict:
    object_ids = {item.id for item in objects}
    positions = {
        item.object_id: item
        for item in db.scalars(
            select(MapPosition).where(
                MapPosition.user_sub == user_sub,
                MapPosition.view_key == position_view_key,
                MapPosition.object_id.in_(object_ids) if object_ids else False,
            )
        ).all()
    }

    counts: dict[uuid.UUID, int] = defaultdict(int)
    tag_values: dict[str, set[str]] = defaultdict(set)
    nodes: list[dict] = []
    for item in objects:
        object_type = item.object_type
        counts[object_type.id] += 1
        for key, value in (item.tags or {}).items():
            if key and value:
                tag_values[str(key)].add(str(value))
        position = positions.get(item.id)
        nodes.append({
            "id": item.id,
            "external_id": item.external_id,
            "name": item.name,
            "description": item.description,
            "status": item.status,
            "criticality": item.criticality,
            "owner_name": item.owner_name,
            "data_owner_name": item.data_owner_name,
            "review_status": item.review_status,
            "confidence_level": item.confidence_level,
            "last_reviewed_at": item.last_reviewed_at,
            "next_review_at": item.next_review_at,
            "review_frequency_days": item.review_frequency_days,
            "protection_level": item.protection_level,
            "tags": item.tags or {},
            "attributes": item.attributes or {},
            "object_type_id": object_type.id,
            "object_type_code": object_type.code,
            "object_type_name": object_type.name,
            "color": object_type.color or "#64748B",
            "icon": object_type.icon,
            "x": position.x if position else None,
            "y": position.y if position else None,
        })

    edges: list[dict] = []
    for item in relations:
        if item.source_id not in object_ids or item.target_id not in object_ids:
            continue
        relation_type = item.relation_type
        edges.append({
            "id": item.id,
            "source_id": item.source_id,
            "target_id": item.target_id,
            "relation_type_id": relation_type.id,
            "relation_type_code": relation_type.code,
            "relation_type_name": relation_type.name,
            "label": item.label,
            "color": relation_type.color or "#94A3B8",
            "directed": relation_type.directed,
            "attributes": item.attributes or {},
        })

    legend_types = {item.object_type.id: item.object_type for item in objects}
    legends = [
        {
            "id": item.id,
            "code": item.code,
            "name": item.name,
            "color": item.color or "#64748B",
            "icon": item.icon,
            "count": counts[item.id],
        }
        for item in sorted(legend_types.values(), key=lambda value: value.name.casefold())
    ]
    available_tags = [
        {"key": key, "values": sorted(values, key=str.casefold)[:100]}
        for key, values in sorted(tag_values.items())
    ]
    return {
        "view": view,
        "nodes": nodes,
        "edges": edges,
        "legends": legends,
        "available_tags": available_tags,
        "total_nodes": total_nodes if total_nodes is not None else len(nodes),
        "total_edges": len(edges),
        "truncated": truncated,
    }


def _all_relations(db: Session, relation_type_ids: set[uuid.UUID] | None = None) -> list[SIRelation]:
    stmt = (
        select(SIRelation)
        .options(selectinload(SIRelation.relation_type))
        .where(SIRelation.active.is_(True))
    )
    if relation_type_ids:
        stmt = stmt.where(SIRelation.relation_type_id.in_(relation_type_ids))
    return list(db.scalars(stmt).unique().all())


def _filtered_objects(db: Session, payload: MapQueryRequest) -> list[SIObject]:
    stmt = (
        select(SIObject)
        .options(selectinload(SIObject.object_type))
        .join(ObjectType)
        .where(SIObject.active.is_(True), ObjectType.active.is_(True))
    )
    if payload.object_type_ids:
        stmt = stmt.where(SIObject.object_type_id.in_(set(payload.object_type_ids)))
    if payload.criticalities:
        stmt = stmt.where(SIObject.criticality.in_(set(payload.criticalities)))
    if payload.statuses:
        stmt = stmt.where(SIObject.status.in_(set(payload.statuses)))
    if payload.q and payload.q.strip():
        pattern = f"%{payload.q.strip()}%"
        stmt = stmt.where(or_(
            SIObject.name.ilike(pattern),
            SIObject.external_id.ilike(pattern),
            SIObject.owner_name.ilike(pattern),
            SIObject.description.ilike(pattern),
        ))
    objects = list(db.scalars(stmt.order_by(SIObject.name)).unique().all())
    filters = _parse_tag_filters(payload.tags)
    if filters:
        objects = [item for item in objects if _matches_tags(item, filters)]
    return objects


def _build_query_graph(db: Session, payload: MapQueryRequest) -> tuple[list[SIObject], list[SIRelation], int, bool, int]:
    if payload.max_depth > settings.map_max_recursion_depth:
        raise HTTPException(status_code=422, detail=f"La profondeur maximale autorisée est {settings.map_max_recursion_depth}.")
    effective_limit = min(payload.limit, settings.map_max_displayed_nodes)
    allowed_objects = _filtered_objects(db, payload)
    allowed_ids = {item.id for item in allowed_objects}
    relation_filter = set(payload.relation_type_ids) if payload.relation_type_ids else None
    relations = _all_relations(db, relation_filter)

    if not payload.root_object_ids:
        selected = allowed_objects[:effective_limit]
        selected_ids = {item.id for item in selected}
        selected_relations = [item for item in relations if item.source_id in selected_ids and item.target_id in selected_ids]
        return selected, selected_relations, len(allowed_objects), len(allowed_objects) > effective_limit, 0

    roots = set(payload.root_object_ids)
    missing = roots - allowed_ids
    if missing:
        # A root can be outside the selected type filter: keep it so the map remains understandable.
        extra = list(db.scalars(
            select(SIObject).options(selectinload(SIObject.object_type)).where(SIObject.active.is_(True), SIObject.id.in_(missing))
        ).unique().all())
        allowed_objects.extend(extra)
        allowed_ids.update(item.id for item in extra)
    valid_roots = roots & allowed_ids
    if not valid_roots:
        raise HTTPException(status_code=422, detail="Aucun objet de départ actif n’a été trouvé.")

    outgoing: dict[uuid.UUID, list[SIRelation]] = defaultdict(list)
    incoming: dict[uuid.UUID, list[SIRelation]] = defaultdict(list)
    for relation in relations:
        if relation.source_id in allowed_ids and relation.target_id in allowed_ids:
            outgoing[relation.source_id].append(relation)
            incoming[relation.target_id].append(relation)

    visited = set(valid_roots)
    selected_relations: dict[uuid.UUID, SIRelation] = {}
    queue: deque[tuple[uuid.UUID, int]] = deque((root, 0) for root in valid_roots)
    max_depth_reached = 0
    while queue and len(visited) < effective_limit:
        current, level = queue.popleft()
        max_depth_reached = max(max_depth_reached, level)
        if level >= payload.max_depth:
            continue
        candidates: list[tuple[SIRelation, uuid.UUID]] = []
        if payload.direction in {"both", "downstream"}:
            candidates.extend((relation, relation.target_id) for relation in outgoing[current])
        if payload.direction in {"both", "upstream"}:
            candidates.extend((relation, relation.source_id) for relation in incoming[current])
        for relation, neighbour_id in candidates:
            selected_relations[relation.id] = relation
            if neighbour_id not in visited and len(visited) < effective_limit:
                visited.add(neighbour_id)
                queue.append((neighbour_id, level + 1))

    by_id = {item.id: item for item in allowed_objects}
    selected = [by_id[item_id] for item_id in visited if item_id in by_id]
    selected.sort(key=lambda item: item.name.casefold())
    truncated = bool(queue) or len(visited) >= effective_limit
    return selected, list(selected_relations.values()), len(visited), truncated, max_depth_reached


@router.get("/catalog", response_model=MapCatalogRead)
def catalog(
    db: Session = Depends(get_db),
    _actor: AuthContext = Depends(require_access("reader")),
):
    object_types = list(db.scalars(select(ObjectType).where(ObjectType.active.is_(True)).order_by(ObjectType.name)).all())
    relation_types = list(db.scalars(select(RelationType).where(RelationType.active.is_(True)).order_by(RelationType.name)).all())
    return {
        "object_types": object_types,
        "relation_types": relation_types,
        "max_recursion_depth": settings.map_max_recursion_depth,
        "max_displayed_nodes": settings.map_max_displayed_nodes,
    }


@router.post("/query", response_model=MapGraphRead)
def query_graph(
    payload: MapQueryRequest,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader")),
):
    objects, relations, total, truncated, _depth = _build_query_graph(db, payload)
    return _serialise_graph(
        db, objects, relations, view="custom", user_sub=actor.subject,
        position_view_key=payload.position_view_key, total_nodes=total, truncated=truncated,
    )


@router.post("/preview", response_model=MapPreviewRead)
def preview_graph(
    payload: MapQueryRequest,
    db: Session = Depends(get_db),
    _actor: AuthContext = Depends(require_access("reader")),
):
    objects, relations, total, truncated, max_depth = _build_query_graph(db, payload)
    return {
        "total_nodes": total if not payload.root_object_ids else len(objects),
        "total_edges": len(relations),
        "truncated": truncated,
        "max_depth_reached": max_depth,
    }


@router.get("/graph", response_model=MapGraphRead)
def graph(
    view: str = "all",
    q: str | None = None,
    criticality: str | None = None,
    status_value: str | None = Query(default=None, alias="status"),
    tag: list[str] = Query(default=[]),
    limit: int = Query(default=800, ge=1, le=2000),
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader")),
):
    view = _normalise_view(view)
    type_codes = VIEW_TYPE_CODES[view]
    type_ids: list[uuid.UUID] = []
    if type_codes:
        type_ids = list(db.scalars(select(ObjectType.id).where(ObjectType.code.in_(type_codes), ObjectType.active.is_(True))).all())
    payload = MapQueryRequest(
        object_type_ids=type_ids,
        q=q,
        criticalities=[criticality] if criticality else [],
        statuses=[status_value] if status_value else [],
        tags=tag,
        limit=limit,
        position_view_key=view,
    )
    objects, relations, total, truncated, _ = _build_query_graph(db, payload)
    return _serialise_graph(db, objects, relations, view=view, user_sub=actor.subject, position_view_key=view, total_nodes=total, truncated=truncated)


@router.get("/neighborhood/{object_id}", response_model=MapGraphRead)
def neighborhood(
    object_id: uuid.UUID,
    depth: int = Query(default=1, ge=0, le=10),
    direction: str = Query(default="both", pattern="^(both|upstream|downstream)$"),
    limit: int = Query(default=500, ge=1, le=1500),
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader")),
):
    payload = MapQueryRequest(root_object_ids=[object_id], direction=direction, max_depth=depth, limit=limit, position_view_key="all")
    objects, relations, total, truncated, _ = _build_query_graph(db, payload)
    return _serialise_graph(db, objects, relations, view="neighborhood", user_sub=actor.subject, position_view_key="all", total_nodes=total, truncated=truncated)


@router.put("/positions", response_model=APIMessage)
def save_positions(
    payload: MapPositionsUpdate,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader", csrf=True)),
):
    object_ids = {item.object_id for item in payload.positions}
    existing_objects = set(db.scalars(select(SIObject.id).where(SIObject.active.is_(True), SIObject.id.in_(object_ids))).all()) if object_ids else set()
    if existing_objects != object_ids:
        raise HTTPException(status_code=422, detail="Une position référence un objet absent ou archivé.")
    existing = {
        item.object_id: item
        for item in db.scalars(select(MapPosition).where(
            MapPosition.user_sub == actor.subject,
            MapPosition.view_key == payload.view_key,
            MapPosition.object_id.in_(object_ids) if object_ids else False,
        )).all()
    }
    for position in payload.positions:
        item = existing.get(position.object_id)
        if item:
            item.x = position.x
            item.y = position.y
        else:
            db.add(MapPosition(user_sub=actor.subject, view_key=payload.view_key, object_id=position.object_id, x=position.x, y=position.y))
    db.commit()
    return APIMessage(message="Positions enregistrées.")


@router.delete("/positions/{view_key}", response_model=APIMessage)
def reset_positions(
    view_key: str,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader", csrf=True)),
):
    if len(view_key) > 80:
        raise HTTPException(status_code=422, detail="Identifiant de vue trop long.")
    db.execute(delete(MapPosition).where(MapPosition.user_sub == actor.subject, MapPosition.view_key == view_key))
    db.commit()
    return APIMessage(message="Positions réinitialisées.")
