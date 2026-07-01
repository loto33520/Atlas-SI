from __future__ import annotations

import csv
import io
import json
import uuid
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import json_safe, model_snapshot, write_audit
from app.database import get_db
from app.models import ImportJob, ObjectType, RelationType, SIObject, SIRelation
from app.routers.objects import validate_object_attributes
from app.routers.relations import _validate_relation
from app.schemas import (
    APIMessage,
    ImportAnalyseRead,
    ImportAnalyseRequest,
    ImportJobRead,
    ImportJobSummaryRead,
    ImportPreviewRequest,
    SIObjectCreate,
    SIRelationCreate,
)
from app.security import AuthContext, require_access

router = APIRouter(prefix="/api/imports", tags=["Imports"])

MAX_ROWS = 5000
OBJECT_FIELDS = [
    "external_id", "type_code", "name", "description", "status", "criticality",
    "owner_name", "tags", "attributes", "active",
]
RELATION_FIELDS = [
    "relation_type_code", "source_ref", "source_type_code", "target_ref", "target_type_code",
    "label", "attributes", "active",
]
ALIASES: dict[str, tuple[str, ...]] = {
    "external_id": ("external_id", "identifiant", "id_externe", "id"),
    "type_code": ("type_code", "type", "type_objet", "object_type"),
    "name": ("name", "nom", "libelle"),
    "description": ("description", "detail"),
    "status": ("status", "statut", "etat"),
    "criticality": ("criticality", "criticite", "criticité"),
    "owner_name": ("owner_name", "responsable", "proprietaire", "propriétaire"),
    "tags": ("tags", "etiquettes", "étiquettes"),
    "attributes": ("attributes", "attributs", "informations", "details"),
    "active": ("active", "actif"),
    "relation_type_code": ("relation_type_code", "type_relation", "relation", "relation_type"),
    "source_ref": ("source_ref", "source", "origine"),
    "source_type_code": ("source_type_code", "type_source"),
    "target_ref": ("target_ref", "target", "cible", "destination"),
    "target_type_code": ("target_type_code", "type_cible"),
    "label": ("label", "libelle_relation", "libellé_relation", "flux"),
}


def _normalise_column(value: str) -> str:
    return value.strip().lower().replace(" ", "_").replace("-", "_")


def _parse_content(payload: ImportAnalyseRequest) -> tuple[list[str], list[dict[str, Any]]]:
    if payload.source_format == "json":
        try:
            parsed = json.loads(payload.content)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422, detail=f"JSON invalide à la ligne {exc.lineno}.") from exc
        if isinstance(parsed, dict):
            key = payload.entity_kind
            parsed = parsed.get(key, parsed.get("items"))
        if not isinstance(parsed, list):
            raise HTTPException(status_code=422, detail="Le JSON doit contenir une liste de lignes.")
        if len(parsed) > MAX_ROWS:
            raise HTTPException(status_code=422, detail=f"Le fichier dépasse la limite de {MAX_ROWS} lignes.")
        rows: list[dict[str, Any]] = []
        for index, item in enumerate(parsed, start=1):
            if not isinstance(item, dict):
                raise HTTPException(status_code=422, detail=f"La ligne JSON {index} n'est pas un objet.")
            rows.append({str(key): value for key, value in item.items()})
        columns = sorted({key for row in rows for key in row.keys()})
        return columns, rows

    sample = payload.content[:8192]
    delimiter = payload.delimiter
    if not delimiter:
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=";,\t|").delimiter
        except csv.Error:
            delimiter = ";"
    reader = csv.DictReader(io.StringIO(payload.content.lstrip("\ufeff")), delimiter=delimiter)
    if not reader.fieldnames:
        raise HTTPException(status_code=422, detail="Le CSV ne contient pas d'en-tête.")
    columns = [str(value).strip() for value in reader.fieldnames if value is not None]
    rows = []
    for csv_row_number, row in enumerate(reader, start=2):
        if len(rows) >= MAX_ROWS:
            raise HTTPException(status_code=422, detail=f"Le fichier dépasse la limite de {MAX_ROWS} lignes.")
        if None in row and any(str(value).strip() for value in (row.get(None) or [])):
            raise HTTPException(status_code=422, detail=f"La ligne CSV {csv_row_number} contient plus de valeurs que l'en-tête. Protège les cellules contenant le séparateur avec des guillemets.")
        clean = {str(key).strip(): (value if value is not None else "") for key, value in row.items() if key is not None}
        if any(str(value).strip() for value in clean.values()):
            rows.append(clean)
    return columns, rows


def _suggest_mapping(columns: list[str], entity_kind: str) -> dict[str, str]:
    by_normalised = {_normalise_column(column): column for column in columns}
    fields = OBJECT_FIELDS if entity_kind == "objects" else RELATION_FIELDS
    result: dict[str, str] = {}
    for field in fields:
        for alias in ALIASES.get(field, (field,)):
            found = by_normalised.get(_normalise_column(alias))
            if found:
                result[field] = found
                break
    return result


def _mapped(row: dict[str, Any], mapping: dict[str, str], field: str) -> Any:
    source = mapping.get(field)
    if not source:
        return None
    return row.get(source)


def _object_update_fields(mapping: dict[str, str]) -> list[str]:
    canonical_to_model = {
        "external_id": "external_id", "type_code": "object_type_id", "name": "name",
        "description": "description", "status": "status", "criticality": "criticality",
        "owner_name": "owner_name", "tags": "tags", "attributes": "attributes", "active": "active",
    }
    return [model for canonical, model in canonical_to_model.items() if mapping.get(canonical)]


def _relation_update_fields(mapping: dict[str, str]) -> list[str]:
    canonical_to_model = {
        "relation_type_code": "relation_type_id", "source_ref": "source_id", "target_ref": "target_id",
        "label": "label", "attributes": "attributes", "active": "active",
    }
    return [model for canonical, model in canonical_to_model.items() if mapping.get(canonical)]


def _text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value).strip()


def _bool(value: Any, default: bool = True) -> bool:
    if value is None or _text(value) == "":
        return default
    if isinstance(value, bool):
        return value
    normalized = _text(value).casefold()
    if normalized in {"1", "true", "oui", "yes", "y", "actif", "active"}:
        return True
    if normalized in {"0", "false", "non", "no", "n", "inactif", "inactive"}:
        return False
    raise ValueError(f"Valeur booléenne invalide : {value}")


def _key_values(value: Any, *, strings_only: bool = False) -> dict[str, Any]:
    if value is None or value == "":
        return {}
    if isinstance(value, dict):
        return {str(key).strip(): (str(item) if strings_only else item) for key, item in value.items() if str(key).strip()}
    text = str(value).strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return {str(key).strip(): (str(item) if strings_only else item) for key, item in parsed.items() if str(key).strip()}
    except json.JSONDecodeError:
        pass
    result: dict[str, Any] = {}
    for part in text.replace("|", ";").split(";"):
        part = part.strip()
        if not part:
            continue
        separator = "=" if "=" in part else ":" if ":" in part else None
        if not separator:
            raise ValueError(f"Paire clé/valeur invalide : {part}")
        key, raw = part.split(separator, 1)
        key = key.strip()
        raw = raw.strip()
        if not key:
            raise ValueError("Une clé d'étiquette ou d'information est vide.")
        if strings_only:
            result[key] = raw
        else:
            try:
                result[key] = json.loads(raw)
            except json.JSONDecodeError:
                result[key] = raw
    return result


def _find_object_type(db: Session, reference: str) -> ObjectType | None:
    normalized = reference.strip().casefold()
    return db.scalar(
        select(ObjectType).where(
            ObjectType.active.is_(True),
            or_(func.lower(ObjectType.code) == normalized, func.lower(ObjectType.name) == normalized),
        )
    )


def _find_relation_type(db: Session, reference: str) -> RelationType | None:
    normalized = reference.strip().casefold()
    return db.scalar(
        select(RelationType).where(
            RelationType.active.is_(True),
            or_(func.lower(RelationType.code) == normalized, func.lower(RelationType.name) == normalized),
        )
    )


def _resolve_object(db: Session, reference: str, type_code: str = "") -> SIObject | None:
    reference = reference.strip()
    if not reference:
        return None
    stmt = select(SIObject).join(ObjectType).where(
        SIObject.active.is_(True),
        or_(SIObject.external_id == reference, func.lower(SIObject.name) == reference.casefold()),
    )
    if type_code:
        stmt = stmt.where(func.lower(ObjectType.code) == type_code.strip().casefold())
    matches = list(db.scalars(stmt.limit(3)).all())
    if len(matches) > 1:
        raise ValueError(f"La référence « {reference} » est ambiguë ; précise le type.")
    return matches[0] if matches else None


def _find_object_duplicate(db: Session, payload: dict[str, Any]) -> SIObject | None:
    if payload.get("external_id"):
        found = db.scalar(select(SIObject).where(SIObject.external_id == payload["external_id"]))
        if found:
            return found
    return db.scalar(select(SIObject).where(
        SIObject.object_type_id == payload["object_type_id"],
        func.lower(SIObject.name) == payload["name"].casefold(),
    ))


def _row_result(row_number: int, status: str, action: str, identity: str, data: dict[str, Any], message: str | None = None) -> dict[str, Any]:
    return {"row_number": row_number, "status": status, "action": action, "identity": identity, "message": message, "data": data}


def _preview_objects(db: Session, rows: list[dict[str, Any]], mapping: dict[str, str], duplicate_mode: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    file_identities: set[str] = set()
    for row_number, row in enumerate(rows, start=2):
        try:
            type_ref = _text(_mapped(row, mapping, "type_code"))
            name = _text(_mapped(row, mapping, "name"))
            external_id = _text(_mapped(row, mapping, "external_id")) or None
            if not type_ref or not name:
                raise ValueError("Le type et le nom sont obligatoires.")
            object_type = _find_object_type(db, type_ref)
            if not object_type:
                raise ValueError(f"Type d'objet introuvable : {type_ref}")
            payload_python = SIObjectCreate.model_validate({
                "external_id": external_id,
                "object_type_id": object_type.id,
                "name": name,
                "description": _text(_mapped(row, mapping, "description")) or None,
                "status": _text(_mapped(row, mapping, "status"), "active") or "active",
                "criticality": _text(_mapped(row, mapping, "criticality"), "unknown") or "unknown",
                "owner_name": _text(_mapped(row, mapping, "owner_name")) or None,
                "tags": _key_values(_mapped(row, mapping, "tags"), strings_only=True),
                "attributes": _key_values(_mapped(row, mapping, "attributes")),
                "active": _bool(_mapped(row, mapping, "active"), True),
            }).model_dump()
            validate_object_attributes(db, object_type.id, payload_python["attributes"])
            identity = external_id or f"{object_type.code}:{name.casefold()}"
            if identity in file_identities:
                raise ValueError("Doublon présent plusieurs fois dans le fichier.")
            file_identities.add(identity)
            duplicate = _find_object_duplicate(db, payload_python)
            payload = json_safe(payload_python)
            payload["update_fields"] = _object_update_fields(mapping)
            if duplicate:
                payload["existing_id"] = str(duplicate.id)
                if duplicate_mode == "error":
                    results.append(_row_result(row_number, "error", "error", identity, payload, "L'objet existe déjà."))
                elif duplicate_mode == "update":
                    results.append(_row_result(row_number, "valid", "update", identity, payload, "Objet existant : mise à jour prévue."))
                else:
                    results.append(_row_result(row_number, "valid", "skip", identity, payload, "Objet existant : ligne ignorée."))
            else:
                results.append(_row_result(row_number, "valid", "create", identity, payload))
        except Exception as exc:
            results.append(_row_result(row_number, "error", "error", f"ligne-{row_number}", {}, str(exc)))
    return results


def _preview_relations(db: Session, rows: list[dict[str, Any]], mapping: dict[str, str], duplicate_mode: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    file_identities: set[str] = set()
    for row_number, row in enumerate(rows, start=2):
        try:
            relation_ref = _text(_mapped(row, mapping, "relation_type_code"))
            source_ref = _text(_mapped(row, mapping, "source_ref"))
            target_ref = _text(_mapped(row, mapping, "target_ref"))
            if not relation_ref or not source_ref or not target_ref:
                raise ValueError("Le type de relation, la source et la cible sont obligatoires.")
            relation_type = _find_relation_type(db, relation_ref)
            if not relation_type:
                raise ValueError(f"Type de relation introuvable : {relation_ref}")
            source = _resolve_object(db, source_ref, _text(_mapped(row, mapping, "source_type_code")))
            target = _resolve_object(db, target_ref, _text(_mapped(row, mapping, "target_type_code")))
            if not source:
                raise ValueError(f"Objet source introuvable : {source_ref}")
            if not target:
                raise ValueError(f"Objet cible introuvable : {target_ref}")
            _validate_relation(db, relation_type.id, source.id, target.id)
            payload_python = SIRelationCreate.model_validate({
                "relation_type_id": relation_type.id,
                "source_id": source.id,
                "target_id": target.id,
                "label": _text(_mapped(row, mapping, "label")),
                "attributes": _key_values(_mapped(row, mapping, "attributes")),
                "active": _bool(_mapped(row, mapping, "active"), True),
            }).model_dump()
            payload = json_safe(payload_python)
            payload["update_fields"] = _relation_update_fields(mapping)
            identity = f"{relation_type.code}:{source.id}:{target.id}:{payload['label']}"
            if identity in file_identities:
                raise ValueError("Doublon présent plusieurs fois dans le fichier.")
            file_identities.add(identity)
            duplicate = db.scalar(select(SIRelation).where(
                SIRelation.relation_type_id == relation_type.id,
                SIRelation.source_id == source.id,
                SIRelation.target_id == target.id,
                SIRelation.label == payload["label"],
            ))
            if duplicate:
                payload["existing_id"] = str(duplicate.id)
                if duplicate_mode == "error":
                    results.append(_row_result(row_number, "error", "error", identity, payload, "La relation existe déjà."))
                elif duplicate_mode == "update":
                    results.append(_row_result(row_number, "valid", "update", identity, payload, "Relation existante : mise à jour prévue."))
                else:
                    results.append(_row_result(row_number, "valid", "skip", identity, payload, "Relation existante : ligne ignorée."))
            else:
                results.append(_row_result(row_number, "valid", "create", identity, payload))
        except HTTPException as exc:
            results.append(_row_result(row_number, "error", "error", f"ligne-{row_number}", {}, str(exc.detail)))
        except Exception as exc:
            results.append(_row_result(row_number, "error", "error", f"ligne-{row_number}", {}, str(exc)))
    return results


def _summary(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(item["action"] for item in rows)
    return {
        "rows": len(rows),
        "valid": sum(1 for item in rows if item["status"] == "valid"),
        "errors": sum(1 for item in rows if item["status"] == "error"),
        "create": counts["create"],
        "update": counts["update"],
        "skip": counts["skip"],
    }


@router.post("/analyse", response_model=ImportAnalyseRead)
def analyse_import(
    payload: ImportAnalyseRequest,
    _: AuthContext = Depends(require_access("contributor", "admin", csrf=True)),
):
    columns, rows = _parse_content(payload)
    return {
        "columns": columns,
        "sample": rows[:5],
        "suggested_mapping": _suggest_mapping(columns, payload.entity_kind),
        "row_count": len(rows),
    }


@router.post("/preview", response_model=ImportJobRead)
def preview_import(
    payload: ImportPreviewRequest,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("contributor", "admin", csrf=True)),
):
    columns, rows = _parse_content(payload)
    mapping = payload.mapping or _suggest_mapping(columns, payload.entity_kind)
    preview_rows = (
        _preview_objects(db, rows, mapping, payload.duplicate_mode)
        if payload.entity_kind == "objects"
        else _preview_relations(db, rows, mapping, payload.duplicate_mode)
    )
    job = ImportJob(
        entity_kind=payload.entity_kind,
        source_format=payload.source_format,
        filename=payload.filename,
        status="preview",
        duplicate_mode=payload.duplicate_mode,
        actor_sub=actor.subject,
        actor_username=actor.username,
        mapping=mapping,
        summary=_summary(preview_rows),
        preview_rows=preview_rows,
        changes=[],
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def _uuid_fields(data: dict[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    result = dict(data)
    for field in fields:
        if result.get(field) is not None and not isinstance(result[field], uuid.UUID):
            result[field] = uuid.UUID(str(result[field]))
    return result


def _apply_object_row(db: Session, request: Request, actor: AuthContext, row: dict[str, Any]) -> dict[str, Any] | None:
    action = row["action"]
    if action == "skip":
        return None
    data = _uuid_fields(dict(row["data"]), ("object_type_id",))
    existing_id = data.pop("existing_id", None)
    update_fields = set(data.pop("update_fields", []))
    if action == "create":
        item = SIObject(**data)
        db.add(item)
        db.flush()
        after = model_snapshot(item)
        write_audit(db, request, actor, action="import_create", entity_type="si_object", entity_id=str(item.id), before=None, after=after)
        return {"entity_type": "si_object", "entity_id": str(item.id), "action": "create", "before": None, "after": after}
    item = db.get(SIObject, uuid.UUID(str(existing_id)))
    if not item:
        raise ValueError("Objet à mettre à jour introuvable.")
    before = model_snapshot(item)
    for key, value in data.items():
        if key in update_fields:
            setattr(item, key, value)
    db.flush()
    after = model_snapshot(item)
    write_audit(db, request, actor, action="import_update", entity_type="si_object", entity_id=str(item.id), before=before, after=after)
    return {"entity_type": "si_object", "entity_id": str(item.id), "action": "update", "before": before, "after": after}


def _apply_relation_row(db: Session, request: Request, actor: AuthContext, row: dict[str, Any]) -> dict[str, Any] | None:
    action = row["action"]
    if action == "skip":
        return None
    data = _uuid_fields(dict(row["data"]), ("relation_type_id", "source_id", "target_id"))
    existing_id = data.pop("existing_id", None)
    update_fields = set(data.pop("update_fields", []))
    if action == "create":
        item = SIRelation(**data)
        db.add(item)
        db.flush()
        after = model_snapshot(item)
        write_audit(db, request, actor, action="import_create", entity_type="si_relation", entity_id=str(item.id), before=None, after=after)
        return {"entity_type": "si_relation", "entity_id": str(item.id), "action": "create", "before": None, "after": after}
    item = db.get(SIRelation, uuid.UUID(str(existing_id)))
    if not item:
        raise ValueError("Relation à mettre à jour introuvable.")
    before = model_snapshot(item)
    for key, value in data.items():
        if key in update_fields:
            setattr(item, key, value)
    db.flush()
    after = model_snapshot(item)
    write_audit(db, request, actor, action="import_update", entity_type="si_relation", entity_id=str(item.id), before=before, after=after)
    return {"entity_type": "si_relation", "entity_id": str(item.id), "action": "update", "before": before, "after": after}


@router.post("/{job_id}/apply", response_model=ImportJobRead)
def apply_import(
    job_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("contributor", "admin", csrf=True)),
):
    job = db.get(ImportJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Import introuvable.")
    if job.actor_sub != actor.subject and "admin" not in actor.roles:
        raise HTTPException(status_code=403, detail="Seul l'auteur ou un administrateur peut appliquer cet import.")
    if job.status != "preview":
        raise HTTPException(status_code=409, detail="Cet import n'est plus en attente d'application.")
    if int(job.summary.get("errors", 0)):
        raise HTTPException(status_code=409, detail="Corrige les erreurs de l'aperçu avant d'appliquer l'import.")
    changes: list[dict[str, Any]] = []
    try:
        for row in job.preview_rows:
            change = (
                _apply_object_row(db, request, actor, row)
                if job.entity_kind == "objects"
                else _apply_relation_row(db, request, actor, row)
            )
            if change:
                changes.append(change)
        job.changes = changes
        job.status = "applied"
        job.applied_at = datetime.now(timezone.utc)
        job.summary = {**job.summary, "applied": len(changes)}
        db.flush()
        write_audit(db, request, actor, action="apply", entity_type="import_job", entity_id=str(job.id), before=None, after=model_snapshot(job))
        db.commit()
    except (IntegrityError, ValueError) as exc:
        db.rollback()
        failed = db.get(ImportJob, job_id)
        if failed:
            failed.status = "failed"
            failed.summary = {**failed.summary, "failure": str(exc)}
            db.commit()
        raise HTTPException(status_code=409, detail=f"L'import n'a pas été appliqué : {exc}") from exc
    db.refresh(job)
    return job


def _important_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in snapshot.items() if key not in {"created_at", "updated_at"}}


def _restore_snapshot(item: SIObject | SIRelation, snapshot: dict[str, Any]) -> None:
    uuid_fields = {"id", "object_type_id", "relation_type_id", "source_id", "target_id"}
    for key, value in snapshot.items():
        if key in {"id", "created_at", "updated_at"}:
            continue
        if key in uuid_fields and value is not None:
            value = uuid.UUID(str(value))
        setattr(item, key, value)


@router.post("/{job_id}/rollback", response_model=ImportJobRead)
def rollback_import(
    job_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("contributor", "admin", csrf=True)),
):
    job = db.get(ImportJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Import introuvable.")
    if job.actor_sub != actor.subject and "admin" not in actor.roles:
        raise HTTPException(status_code=403, detail="Seul l'auteur ou un administrateur peut annuler cet import.")
    if job.status != "applied":
        raise HTTPException(status_code=409, detail="Seul un import appliqué peut être annulé.")

    imported_relation_ids = {
        uuid.UUID(change["entity_id"])
        for change in job.changes
        if change["entity_type"] == "si_relation" and change["action"] == "create"
    }
    try:
        for change in reversed(job.changes):
            model = SIObject if change["entity_type"] == "si_object" else SIRelation
            item = db.get(model, uuid.UUID(change["entity_id"]))
            if not item:
                raise ValueError(f"Élément importé introuvable : {change['entity_id']}")
            current = _important_snapshot(model_snapshot(item))
            expected = _important_snapshot(change["after"])
            if current != expected:
                raise ValueError("Un élément a été modifié depuis l'import ; annulation automatique refusée.")
            before = model_snapshot(item)
            if change["action"] == "create":
                if isinstance(item, SIObject):
                    active_relations = [
                        relation.id for relation in [*item.outgoing_relations, *item.incoming_relations]
                        if relation.active and relation.id not in imported_relation_ids
                    ]
                    if active_relations:
                        raise ValueError("Un objet créé par l'import possède désormais des relations externes ; annulation refusée.")
                item.active = False
            else:
                _restore_snapshot(item, change["before"])
            db.flush()
            write_audit(
                db, request, actor, action="import_rollback", entity_type=change["entity_type"],
                entity_id=change["entity_id"], before=before, after=model_snapshot(item)
            )
        before_job = model_snapshot(job)
        job.status = "rolled_back"
        job.rolled_back_at = datetime.now(timezone.utc)
        db.flush()
        write_audit(db, request, actor, action="rollback", entity_type="import_job", entity_id=str(job.id), before=before_job, after=model_snapshot(job))
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    db.refresh(job)
    return job


@router.get("", response_model=list[ImportJobSummaryRead])
def list_imports(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_access("contributor", "admin")),
):
    return list(db.scalars(select(ImportJob).order_by(ImportJob.created_at.desc()).limit(limit)).all())


@router.get("/{job_id}", response_model=ImportJobRead)
def read_import(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: AuthContext = Depends(require_access("contributor", "admin")),
):
    job = db.get(ImportJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Import introuvable.")
    return job


@router.get("/template/{entity_kind}", response_class=PlainTextResponse)
def import_template(
    entity_kind: str,
    _: AuthContext = Depends(require_access("contributor", "admin")),
):
    if entity_kind == "objects":
        return PlainTextResponse(
            "external_id;type_code;name;description;status;criticality;owner_name;tags;attributes;active\n"
            "APP-ERP;application;ERP;Gestion commerciale;active;critical;DSI;environnement=production;version=1.0;true\n",
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="modele-objets-atlas-si.csv"'},
        )
    if entity_kind == "relations":
        return PlainTextResponse(
            "relation_type_code;source_ref;source_type_code;target_ref;target_type_code;label;attributes;active\n"
            "hosted_on;APP-ERP;application;VM-ERP-01;server;Production;port=443;true\n",
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="modele-relations-atlas-si.csv"'},
        )
    raise HTTPException(status_code=404, detail="Modèle d'import inconnu.")
