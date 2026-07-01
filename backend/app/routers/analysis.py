from __future__ import annotations

import uuid
from collections import Counter, defaultdict, deque
from typing import Iterable

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.audit import json_safe, model_snapshot, write_audit
from app.database import get_db
from app.models import ImpactScenario, SIObject, SIRelation
from app.schemas import (
    APIMessage,
    ImpactAnalysisRead,
    ImpactAnalysisRequest,
    ImpactScenarioCreate,
    ImpactScenarioRead,
)
from app.security import AuthContext, require_access

router = APIRouter(prefix="/api/analysis", tags=["Analyse d'impact"])

CRITICALITY_WEIGHT = {
    "critical": 100,
    "high": 80,
    "medium": 55,
    "low": 30,
    "unknown": 20,
}


def _load_active_graph(db: Session, relation_type_ids: set[uuid.UUID]) -> tuple[dict[uuid.UUID, SIObject], list[SIRelation]]:
    objects = {
        item.id: item
        for item in db.scalars(
            select(SIObject)
            .options(selectinload(SIObject.object_type))
            .where(SIObject.active.is_(True))
        ).unique().all()
    }
    relation_stmt = (
        select(SIRelation)
        .options(selectinload(SIRelation.relation_type))
        .where(SIRelation.active.is_(True))
    )
    if relation_type_ids:
        relation_stmt = relation_stmt.where(SIRelation.relation_type_id.in_(relation_type_ids))
    relations = [
        relation
        for relation in db.scalars(relation_stmt).unique().all()
        if relation.source_id in objects and relation.target_id in objects and relation.relation_type.active
    ]
    return objects, relations


def _steps_for_relation(relation: SIRelation, current: uuid.UUID, direction: str) -> Iterable[tuple[uuid.UUID, str]]:
    """Retourne les voisins autorisés et le sens de parcours logique."""
    directed = bool(relation.relation_type.directed)
    if not directed:
        if current == relation.source_id:
            yield relation.target_id, "undirected"
        elif current == relation.target_id:
            yield relation.source_id, "undirected"
        return

    if direction in {"downstream", "both"} and current == relation.source_id:
        yield relation.target_id, "outgoing"
    if direction in {"upstream", "both"} and current == relation.target_id:
        yield relation.source_id, "incoming"


def _canonical_cycle(node_ids: list[uuid.UUID]) -> tuple[str, ...]:
    values = [str(value) for value in node_ids[:-1] if node_ids and value is not None]
    if not values:
        return tuple()
    rotations = [tuple(values[index:] + values[:index]) for index in range(len(values))]
    reversed_values = list(reversed(values))
    rotations.extend(tuple(reversed_values[index:] + reversed_values[:index]) for index in range(len(values)))
    return min(rotations)


def _find_cycles(
    included_ids: set[uuid.UUID],
    relations: list[SIRelation],
    max_cycles: int = 50,
) -> list[dict]:
    adjacency: dict[uuid.UUID, list[tuple[uuid.UUID, uuid.UUID]]] = defaultdict(list)
    for relation in relations:
        if relation.source_id not in included_ids or relation.target_id not in included_ids:
            continue
        adjacency[relation.source_id].append((relation.target_id, relation.id))
        if not relation.relation_type.directed:
            adjacency[relation.target_id].append((relation.source_id, relation.id))

    cycles: list[dict] = []
    seen: set[tuple[str, ...]] = set()

    def walk(start: uuid.UUID, current: uuid.UUID, nodes: list[uuid.UUID], rels: list[uuid.UUID]) -> None:
        if len(cycles) >= max_cycles or len(nodes) > 12:
            return
        for neighbor, relation_id in adjacency.get(current, []):
            if neighbor == start and len(nodes) >= 3:
                cycle_nodes = [*nodes, start]
                key = _canonical_cycle(cycle_nodes)
                if key and key not in seen:
                    seen.add(key)
                    cycles.append({"node_ids": cycle_nodes, "relation_ids": [*rels, relation_id]})
                continue
            if neighbor in nodes:
                continue
            walk(start, neighbor, [*nodes, neighbor], [*rels, relation_id])

    for object_id in sorted(included_ids, key=str):
        walk(object_id, object_id, [object_id], [])
        if len(cycles) >= max_cycles:
            break
    return cycles


def calculate_impact(db: Session, payload: ImpactAnalysisRequest) -> dict:
    relation_filter = set(payload.relation_type_ids)
    excluded = set(payload.excluded_object_ids)
    excluded.discard(payload.root_object_id)
    objects, relations = _load_active_graph(db, relation_filter)

    root = objects.get(payload.root_object_id)
    if not root:
        raise HTTPException(status_code=404, detail="Objet racine introuvable ou archivé.")

    by_object: dict[uuid.UUID, list[SIRelation]] = defaultdict(list)
    for relation in relations:
        by_object[relation.source_id].append(relation)
        if relation.target_id != relation.source_id:
            by_object[relation.target_id].append(relation)

    depths: dict[uuid.UUID, int] = {root.id: 0}
    path_nodes: dict[uuid.UUID, list[uuid.UUID]] = {root.id: [root.id]}
    path_relations: dict[uuid.UUID, list[uuid.UUID]] = {root.id: []}
    paths_count: Counter[uuid.UUID] = Counter({root.id: 1})
    included_relation_ids: set[uuid.UUID] = set()
    queue: deque[uuid.UUID] = deque([root.id])

    while queue:
        current = queue.popleft()
        current_depth = depths[current]
        if current_depth >= payload.max_depth:
            continue
        for relation in by_object.get(current, []):
            for neighbor, _traversal in _steps_for_relation(relation, current, payload.direction):
                if neighbor in excluded or neighbor not in objects:
                    continue
                next_depth = current_depth + 1
                previous_depth = depths.get(neighbor)
                if previous_depth is None:
                    depths[neighbor] = next_depth
                    path_nodes[neighbor] = [*path_nodes[current], neighbor]
                    path_relations[neighbor] = [*path_relations[current], relation.id]
                    queue.append(neighbor)
                if previous_depth is None or next_depth <= previous_depth:
                    paths_count[neighbor] += 1
                    included_relation_ids.add(relation.id)

    included_ids = set(depths)
    included_relations = [
        relation for relation in relations
        if relation.source_id in included_ids
        and relation.target_id in included_ids
    ]

    node_rows: list[dict] = []
    by_type: Counter[str] = Counter()
    by_criticality: Counter[str] = Counter()
    owners: set[str] = set()
    for object_id, depth in sorted(depths.items(), key=lambda item: (item[1], objects[item[0]].name.casefold())):
        item = objects[object_id]
        by_type[item.object_type.name] += 1
        by_criticality[item.criticality] += 1
        if item.owner_name:
            owners.add(item.owner_name)
        base = CRITICALITY_WEIGHT.get(item.criticality, CRITICALITY_WEIGHT["unknown"])
        score = 100 if depth == 0 else max(5, round(base / (1 + (depth - 1) * 0.45)))
        node_rows.append({
            "id": item.id,
            "name": item.name,
            "object_type_code": item.object_type.code,
            "object_type_name": item.object_type.name,
            "criticality": item.criticality,
            "owner_name": item.owner_name,
            "depth": depth,
            "paths_count": int(paths_count[object_id]),
            "impact_score": score,
            "is_root": depth == 0,
        })

    edge_rows = [{
        "id": relation.id,
        "source_id": relation.source_id,
        "target_id": relation.target_id,
        "relation_type_id": relation.relation_type_id,
        "relation_type_name": relation.relation_type.name,
        "label": relation.label,
        "directed": relation.relation_type.directed,
    } for relation in included_relations]

    paths = [{
        "node_ids": path_nodes[object_id],
        "relation_ids": path_relations[object_id],
        "depth": depths[object_id],
    } for object_id in sorted(included_ids, key=lambda value: (depths[value], objects[value].name.casefold())) if object_id != root.id]

    cycles = _find_cycles(included_ids, included_relations)
    return {
        "root_object_id": root.id,
        "direction": payload.direction,
        "max_depth": payload.max_depth,
        "nodes": node_rows,
        "edges": edge_rows,
        "paths": paths,
        "cycles": cycles,
        "summary": {
            "total_nodes": len(node_rows),
            "total_edges": len(edge_rows),
            "max_depth_reached": max(depths.values(), default=0),
            "by_type": dict(sorted(by_type.items())),
            "by_criticality": dict(sorted(by_criticality.items())),
            "owners": sorted(owners, key=str.casefold),
            "has_cycles": bool(cycles),
        },
    }


@router.post("/impact", response_model=ImpactAnalysisRead)
def impact_analysis(
    payload: ImpactAnalysisRequest,
    db: Session = Depends(get_db),
    _actor: AuthContext = Depends(require_access("reader")),
):
    return calculate_impact(db, payload)


@router.get("/scenarios", response_model=list[ImpactScenarioRead])
def list_scenarios(
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader")),
):
    stmt = select(ImpactScenario).where(ImpactScenario.active.is_(True))
    if "admin" not in actor.roles and "auditor" not in actor.roles:
        stmt = stmt.where(ImpactScenario.actor_sub == actor.subject)
    return list(db.scalars(stmt.order_by(ImpactScenario.updated_at.desc())).all())


@router.post("/scenarios", response_model=ImpactScenarioRead, status_code=201)
def create_scenario(
    payload: ImpactScenarioCreate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("contributor", "admin", csrf=True)),
):
    result = calculate_impact(db, payload.analysis)
    scenario = ImpactScenario(
        name=payload.name.strip(),
        description=payload.description.strip() if payload.description else None,
        root_object_id=payload.analysis.root_object_id,
        direction=payload.analysis.direction,
        max_depth=payload.analysis.max_depth,
        relation_type_ids=[str(value) for value in payload.analysis.relation_type_ids],
        excluded_object_ids=[str(value) for value in payload.analysis.excluded_object_ids],
        result_snapshot=json_safe(result),
        actor_sub=actor.subject,
        actor_username=actor.username,
    )
    db.add(scenario)
    db.flush()
    write_audit(
        db, request, actor,
        action="create", entity_type="impact_scenario", entity_id=str(scenario.id),
        before=None, after=model_snapshot(scenario),
    )
    db.commit()
    db.refresh(scenario)
    return scenario


@router.get("/scenarios/{scenario_id}", response_model=ImpactScenarioRead)
def get_scenario(
    scenario_id: uuid.UUID,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("reader")),
):
    scenario = db.get(ImpactScenario, scenario_id)
    if not scenario or not scenario.active:
        raise HTTPException(status_code=404, detail="Scénario introuvable.")
    if scenario.actor_sub != actor.subject and not ({"admin", "auditor"} & set(actor.roles)):
        raise HTTPException(status_code=403, detail="Droits insuffisants.")
    return scenario


@router.delete("/scenarios/{scenario_id}", response_model=APIMessage)
def delete_scenario(
    scenario_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("contributor", "admin", csrf=True)),
):
    scenario = db.get(ImpactScenario, scenario_id)
    if not scenario or not scenario.active:
        raise HTTPException(status_code=404, detail="Scénario introuvable.")
    if scenario.actor_sub != actor.subject and "admin" not in actor.roles:
        raise HTTPException(status_code=403, detail="Droits insuffisants.")
    before = model_snapshot(scenario)
    scenario.active = False
    write_audit(
        db, request, actor,
        action="archive", entity_type="impact_scenario", entity_id=str(scenario.id),
        before=before, after=model_snapshot(scenario),
    )
    db.commit()
    return {"message": "Scénario archivé."}
