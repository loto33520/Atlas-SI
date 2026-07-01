from __future__ import annotations

import csv
import io
from collections import Counter
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import AuditEvent, SIObject, SIRelation, VersionObservation
from app.security import AuthContext, require_access
from app.versioning import utcnow

router = APIRouter(prefix="/api/quality", tags=["Quality"])


def collect_issues(db: Session, stale_days: int = 365) -> list[dict]:
    objects = list(db.scalars(
        select(SIObject).options(selectinload(SIObject.object_type)).where(SIObject.active.is_(True))
    ).all())
    relations = list(db.scalars(select(SIRelation).where(SIRelation.active.is_(True))).all())
    linked = {r.source_id for r in relations} | {r.target_id for r in relations}
    process_ids = {o.id for o in objects if o.object_type.code == "process"}
    site_ids = {o.id for o in objects if o.object_type.code == "site"}
    app_to_process = set()
    server_to_site = set()
    for relation in relations:
        if relation.source_id in process_ids:
            app_to_process.add(relation.target_id)
        if relation.target_id in process_ids:
            app_to_process.add(relation.source_id)
        if relation.source_id in site_ids:
            server_to_site.add(relation.target_id)
        if relation.target_id in site_ids:
            server_to_site.add(relation.source_id)

    current_versions: dict = {}
    version_rows = list(db.scalars(
        select(VersionObservation).where(VersionObservation.active.is_(True)).order_by(
            VersionObservation.object_id, VersionObservation.observed_at.desc(), VersionObservation.created_at.desc()
        )
    ).all())
    for row in version_rows:
        current_versions.setdefault(row.object_id, row)

    issues: list[dict] = []
    stale_limit = utcnow() - timedelta(days=stale_days)

    def add(code, severity, obj, fr, en):
        issues.append({
            "code": code,
            "severity": severity,
            "object_id": obj.id if obj else None,
            "object_name": obj.name if obj else None,
            "object_type": obj.object_type.name if obj else None,
            "message_fr": fr,
            "message_en": en,
        })

    for obj in objects:
        if not (obj.owner_name or "").strip():
            add("missing_owner", "critical" if obj.criticality in {"critical", "high"} else "warning", obj,
                "Aucun responsable n’est renseigné.", "No owner is assigned.")
        if obj.id not in linked:
            add("isolated_object", "warning", obj, "L’objet ne possède aucune relation active.", "The object has no active relationship.")
        if obj.object_type.code == "application" and obj.id not in app_to_process:
            add("application_without_process", "warning", obj, "L’application n’est reliée à aucun processus.", "The application is not linked to any process.")
        if obj.object_type.code == "server" and obj.id not in server_to_site:
            add("server_without_site", "warning", obj, "Le serveur n’est relié à aucun site.", "The server is not linked to any site.")
        if obj.updated_at:
            updated_at = obj.updated_at if obj.updated_at.tzinfo else obj.updated_at.replace(tzinfo=timezone.utc)
            if updated_at < stale_limit:
                add("stale_object", "information", obj, f"L’objet n’a pas été revu depuis plus de {stale_days} jours.", f"The object has not been reviewed for more than {stale_days} days.")
        if obj.review_status == "draft":
            add("review_draft", "information", obj, "L’objet n’a pas encore été validé.", "The object has not been validated yet.")
        elif obj.review_status == "outdated":
            add("review_outdated", "warning", obj, "L’objet est marqué comme devant être revu.", "The object is marked as requiring review.")
        if obj.confidence_level == "unknown":
            add("unknown_confidence", "information", obj, "Le niveau de confiance n’est pas renseigné.", "The confidence level is not set.")
        if obj.next_review_at and obj.next_review_at < utcnow().date():
            add("review_overdue", "critical" if obj.criticality in {"critical", "high"} else "warning", obj, "La date de prochaine revue est dépassée.", "The next review date is overdue.")
        current = current_versions.get(obj.id)
        if current and current.compliance_status == "unsupported":
            add("unsupported_version", "critical", obj, "La version renseignée n’est plus supportée.", "The recorded version is no longer supported.")
    return issues


@router.get("/issues")
def quality_issues(
    stale_days: int = Query(default=365, ge=30, le=3650),
    db: Session = Depends(get_db),
    _actor: AuthContext = Depends(require_access("reader")),
):
    return collect_issues(db, stale_days)


@router.get("/summary")
def quality_summary(
    stale_days: int = Query(default=365, ge=30, le=3650),
    db: Session = Depends(get_db),
    _actor: AuthContext = Depends(require_access("reader")),
):
    issues = collect_issues(db, stale_days)
    severity = Counter(item["severity"] for item in issues)
    codes = Counter(item["code"] for item in issues)
    score = max(0, 100 - severity["critical"] * 12 - severity["warning"] * 4 - severity["information"])
    return {
        "score": score,
        "total_issues": len(issues),
        "critical": severity["critical"],
        "warning": severity["warning"],
        "information": severity["information"],
        "by_code": dict(codes),
    }


@router.get("/export.csv")
def quality_export(
    stale_days: int = Query(default=365, ge=30, le=3650),
    db: Session = Depends(get_db),
    _actor: AuthContext = Depends(require_access("auditor", "admin")),
):
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["severity", "code", "object_id", "object_name", "object_type", "message_fr", "message_en"])
    for issue in collect_issues(db, stale_days):
        writer.writerow([issue[k] for k in ["severity", "code", "object_id", "object_name", "object_type", "message_fr", "message_en"]])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=atlas-si-qualite.csv"})


@router.get("/audit-export.csv")
def audit_export(
    limit: int = Query(default=5000, ge=1, le=20000),
    db: Session = Depends(get_db),
    _actor: AuthContext = Depends(require_access("auditor", "admin")),
):
    rows = list(db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit)).all())
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["created_at", "actor", "action", "entity_type", "entity_id", "request_id", "source_ip"])
    for row in rows:
        writer.writerow([row.created_at.isoformat(), row.actor_username, row.action, row.entity_type, row.entity_id, row.request_id or "", row.source_ip or ""])
    return StreamingResponse(iter([output.getvalue()]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=atlas-si-historique.csv"})
