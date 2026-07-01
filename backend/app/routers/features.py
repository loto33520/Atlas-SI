from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.audit import write_audit
from app.config import get_settings
from app.database import get_db
from app.features import ALL_FEATURE_CODES, feature_payload, get_feature_settings, normalized_features
from app.models import ObjectType, RelationType, SIObject, SIRelation
from app.schemas import (
    AnssiTemplateCatalogRead,
    AnssiTemplateInstallRead,
    AnssiTemplateInstallRequest,
    AnssiTemplateUninstallRead,
    FeatureSettingsRead,
    FeatureSettingsUpdate,
)
from app.security import AuthContext, require_access

router = APIRouter(prefix="/api/features", tags=["Fonctionnalités"])
settings = get_settings()


@router.get("", response_model=FeatureSettingsRead)
def read_features(
    db: Session = Depends(get_db),
    _actor: AuthContext = Depends(require_access("reader")),
):
    return feature_payload(db, settings.feature_profile)


@router.put("", response_model=FeatureSettingsRead)
def update_features(
    payload: FeatureSettingsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", csrf=True)),
):
    unknown = sorted(set(payload.enabled_features) - ALL_FEATURE_CODES)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Fonctionnalité(s) inconnue(s) : {', '.join(unknown)}")
    item = get_feature_settings(db, settings.feature_profile)
    before = {"enabled_features": item.enabled_features, "options": item.options}
    item.enabled_features = normalized_features(payload.enabled_features)
    item.options = payload.options
    db.flush()
    write_audit(db, request, actor, action="update", entity_type="feature_settings", entity_id=str(item.id), before=before, after={
        "enabled_features": item.enabled_features,
        "options": item.options,
    })
    db.commit()
    return feature_payload(db, settings.feature_profile)


ANSSI_OBJECT_TYPES = [
    ("organisation", "Organisation", "building-2", "#475569", "Organisation interne ou externe du périmètre."),
    ("supplier", "Fournisseur", "handshake", "#A16207", "Fournisseur, éditeur ou prestataire."),
    ("saas_service", "Service SaaS", "cloud", "#0284C7", "Service applicatif externalisé."),
    ("contract", "Contrat", "file-signature", "#7C3AED", "Contrat ou engagement de service."),
    ("admin_profile", "Profil d’administration", "shield-user", "#B91C1C", "Profil ou rôle d’administration privilégiée."),
    ("privileged_account", "Compte privilégié", "key-round", "#DC2626", "Compte disposant de droits élevés."),
    ("bastion", "Bastion d’administration", "shield-check", "#C2410C", "Point de passage sécurisé d’administration."),
    ("admin_workstation", "Poste d’administration", "monitor-cog", "#EA580C", "Poste dédié aux opérations d’administration."),
    ("network_zone", "Zone réseau", "network", "#4F46E5", "Zone logique ou segment de sécurité."),
    ("vlan", "VLAN", "waypoints", "#6366F1", "Réseau local virtuel."),
    ("subnet", "Sous-réseau", "git-branch", "#2563EB", "Sous-réseau ou plage IP."),
    ("firewall", "Pare-feu", "shield", "#BE123C", "Équipement ou fonction de filtrage."),
    ("building", "Bâtiment", "building", "#64748B", "Bâtiment ou implantation physique."),
    ("room", "Salle", "door-open", "#78716C", "Salle technique ou espace physique."),
    ("rack", "Baie", "server-cog", "#57534E", "Baie ou armoire technique."),
    ("physical_server", "Serveur physique", "server", "#0369A1", "Serveur matériel."),
    ("storage", "Stockage", "hard-drive", "#0F766E", "Baie, volume ou service de stockage."),
    ("telecom_link", "Lien télécom", "cable", "#0891B2", "Lien WAN, Internet ou opérateur."),
    ("user_profile", "Profil utilisateur", "users", "#7C3AED", "Catégorie d’utilisateur ou population métier."),
]

ANSSI_RELATIONS = [
    ("provides", "Fournit", "#A16207"),
    ("administers", "Administre", "#B91C1C"),
    ("accesses_via", "Accède via", "#C2410C"),
    ("member_of", "Est membre de", "#7C3AED"),
    ("connected_to", "Est connecté à", "#2563EB"),
    ("contained_in", "Est contenu dans", "#64748B"),
    ("backed_up_by", "Est sauvegardé par", "#0F766E"),
    ("protected_by", "Est protégé par", "#BE123C"),
    ("used_by", "Est utilisé par", "#7C3AED"),
]

ANSSI_TEMPLATE_GROUPS = [
    {
        "code": "ecosystem",
        "name_fr": "Écosystème et prestataires",
        "name_en": "Ecosystem and providers",
        "description_fr": "Organisations, fournisseurs, services SaaS et contrats.",
        "description_en": "Organisations, suppliers, SaaS services and contracts.",
        "object_type_codes": ["organisation", "supplier", "saas_service", "contract"],
        "relation_type_codes": ["provides", "used_by"],
    },
    {
        "code": "privileged_administration",
        "name_fr": "Administration privilégiée",
        "name_en": "Privileged administration",
        "description_fr": "Profils et comptes privilégiés, bastions et postes d’administration.",
        "description_en": "Privileged profiles and accounts, bastions and administration workstations.",
        "object_type_codes": ["admin_profile", "privileged_account", "bastion", "admin_workstation"],
        "relation_type_codes": ["administers", "accesses_via", "member_of"],
    },
    {
        "code": "logical_infrastructure",
        "name_fr": "Infrastructure logique",
        "name_en": "Logical infrastructure",
        "description_fr": "Zones réseau, VLAN, sous-réseaux et pare-feu.",
        "description_en": "Network zones, VLANs, subnets and firewalls.",
        "object_type_codes": ["network_zone", "vlan", "subnet", "firewall"],
        "relation_type_codes": ["connected_to", "protected_by"],
    },
    {
        "code": "physical_infrastructure",
        "name_fr": "Infrastructure physique",
        "name_en": "Physical infrastructure",
        "description_fr": "Bâtiments, salles, baies, serveurs physiques, stockage et liens télécom.",
        "description_en": "Buildings, rooms, racks, physical servers, storage and telecom links.",
        "object_type_codes": ["building", "room", "rack", "physical_server", "storage", "telecom_link"],
        "relation_type_codes": ["contained_in", "backed_up_by", "connected_to"],
    },
    {
        "code": "user_profiles",
        "name_fr": "Profils utilisateurs",
        "name_en": "User profiles",
        "description_fr": "Populations métier et profils utilisateurs associés au SI.",
        "description_en": "Business populations and user profiles associated with the IS.",
        "object_type_codes": ["user_profile"],
        "relation_type_codes": ["used_by", "member_of"],
    },
]

ANSSI_OBJECT_TYPES_BY_CODE = {item[0]: item for item in ANSSI_OBJECT_TYPES}
ANSSI_RELATIONS_BY_CODE = {item[0]: item for item in ANSSI_RELATIONS}


def _normalise_color(value: str | None) -> str:
    return (value or "").strip().casefold()


def _matches_default_object_type(item: ObjectType) -> bool:
    definition = ANSSI_OBJECT_TYPES_BY_CODE.get(item.code)
    if not definition:
        return False
    _code, name, icon, color, description = definition
    return (
        item.name == name
        and (item.icon or "") == icon
        and _normalise_color(item.color) == _normalise_color(color)
        and (item.description or "") == description
        and (item.schema or {}) == {}
    )


def _matches_default_relation_type(item: RelationType) -> bool:
    definition = ANSSI_RELATIONS_BY_CODE.get(item.code)
    if not definition:
        return False
    _code, name, color = definition
    return (
        item.name == name
        and _normalise_color(item.color) == _normalise_color(color)
        and item.description is None
        and item.directed is True
        and item.source_type_id is None
        and item.target_type_id is None
    )


def _selected_template_codes(selected_group_codes: list[str]) -> tuple[set[str], set[str]]:
    groups = {group["code"]: group for group in ANSSI_TEMPLATE_GROUPS}
    object_codes: set[str] = set()
    relation_codes: set[str] = set()
    for group_code in selected_group_codes:
        group = groups[group_code]
        object_codes.update(group["object_type_codes"])
        relation_codes.update(group["relation_type_codes"])
    return object_codes, relation_codes


def _validate_groups(payload: AnssiTemplateInstallRequest | None) -> list[str]:
    available_groups = {group["code"]: group for group in ANSSI_TEMPLATE_GROUPS}
    selected = list(dict.fromkeys(payload.groups if payload and payload.groups else available_groups.keys()))
    unknown = sorted(set(selected) - set(available_groups))
    if unknown:
        raise HTTPException(status_code=422, detail=f"Groupe(s) de modèles ANSSI inconnu(s) : {', '.join(unknown)}")
    if not selected:
        raise HTTPException(status_code=422, detail="Sélectionne au moins une famille de modèles ANSSI.")
    return selected


def _active_template_maps(db: Session) -> tuple[dict[str, ObjectType], dict[str, RelationType]]:
    object_codes = set(ANSSI_OBJECT_TYPES_BY_CODE)
    relation_codes = set(ANSSI_RELATIONS_BY_CODE)
    objects = {
        item.code: item
        for item in db.scalars(
            select(ObjectType).where(ObjectType.code.in_(object_codes), ObjectType.active.is_(True))
        ).all()
    }
    relations = {
        item.code: item
        for item in db.scalars(
            select(RelationType).where(RelationType.code.in_(relation_codes), RelationType.active.is_(True))
        ).all()
    }
    return objects, relations


@router.get("/templates/anssi", response_model=AnssiTemplateCatalogRead)
def read_anssi_templates(
    db: Session = Depends(get_db),
    _actor: AuthContext = Depends(require_access("reader")),
):
    active_objects, active_relations = _active_template_maps(db)
    existing_objects = set(active_objects)
    existing_relations = set(active_relations)
    groups = []
    for group in ANSSI_TEMPLATE_GROUPS:
        installed_object_types = len(existing_objects.intersection(group["object_type_codes"]))
        installed_relation_types = len(existing_relations.intersection(group["relation_type_codes"]))
        installed = installed_object_types + installed_relation_types
        total = len(group["object_type_codes"]) + len(group["relation_type_codes"])
        status = "installed" if installed == total else "partial" if installed else "not_installed"
        groups.append({
            **group,
            "installed_object_types": installed_object_types,
            "installed_relation_types": installed_relation_types,
            "status": status,
        })
    return {"groups": groups}


@router.post("/templates/anssi", response_model=AnssiTemplateInstallRead)
def install_anssi_templates(
    request: Request,
    payload: AnssiTemplateInstallRequest | None = None,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", csrf=True)),
):
    selected_group_codes = _validate_groups(payload)
    selected_object_codes, selected_relation_codes = _selected_template_codes(selected_group_codes)

    all_objects = {
        item.code: item
        for item in db.scalars(select(ObjectType).where(ObjectType.code.in_(selected_object_codes))).all()
    }
    created_objects = 0
    reactivated_objects = 0
    for code in selected_object_codes:
        definition = ANSSI_OBJECT_TYPES_BY_CODE[code]
        existing = all_objects.get(code)
        if existing is None:
            _code, name, icon, color, description = definition
            db.add(ObjectType(code=code, name=name, icon=icon, color=color, description=description, schema={}, active=True))
            created_objects += 1
        elif not existing.active and _matches_default_object_type(existing):
            existing.active = True
            reactivated_objects += 1

    all_relations = {
        item.code: item
        for item in db.scalars(select(RelationType).where(RelationType.code.in_(selected_relation_codes))).all()
    }
    created_relations = 0
    reactivated_relations = 0
    for code in selected_relation_codes:
        definition = ANSSI_RELATIONS_BY_CODE[code]
        existing = all_relations.get(code)
        if existing is None:
            _code, name, color = definition
            db.add(RelationType(code=code, name=name, color=color, description=None, directed=True, active=True))
            created_relations += 1
        elif not existing.active and _matches_default_relation_type(existing):
            existing.active = True
            reactivated_relations += 1

    db.flush()
    write_audit(db, request, actor, action="create", entity_type="anssi_templates", entity_id="standard", before=None, after={
        "object_types_created": created_objects,
        "relation_types_created": created_relations,
        "object_types_reactivated": reactivated_objects,
        "relation_types_reactivated": reactivated_relations,
        "selected_groups": selected_group_codes,
    })
    db.commit()
    total_objects = created_objects + reactivated_objects
    total_relations = created_relations + reactivated_relations
    return {
        "message": f"Modèles ANSSI installés : {total_objects} types d’objets et {total_relations} types de relations ajoutés ou réactivés.",
        "selected_groups": selected_group_codes,
        "object_types_created": created_objects,
        "relation_types_created": created_relations,
        "object_types_reactivated": reactivated_objects,
        "relation_types_reactivated": reactivated_relations,
    }


@router.post("/templates/anssi/uninstall", response_model=AnssiTemplateUninstallRead)
def uninstall_anssi_templates(
    payload: AnssiTemplateInstallRequest,
    request: Request,
    db: Session = Depends(get_db),
    actor: AuthContext = Depends(require_access("admin", csrf=True)),
):
    selected_group_codes = _validate_groups(payload)
    selected_object_codes, selected_relation_codes = _selected_template_codes(selected_group_codes)
    active_objects, active_relations = _active_template_maps(db)

    # Les composants partagés avec une autre famille encore entièrement installée sont conservés.
    selected_groups = set(selected_group_codes)
    other_installed_groups: list[dict] = []
    for group in ANSSI_TEMPLATE_GROUPS:
        if group["code"] in selected_groups:
            continue
        if (
            set(group["object_type_codes"]).issubset(active_objects)
            and set(group["relation_type_codes"]).issubset(active_relations)
        ):
            other_installed_groups.append(group)
    protected_object_codes = {code for group in other_installed_groups for code in group["object_type_codes"]}
    protected_relation_codes = {code for group in other_installed_groups for code in group["relation_type_codes"]}

    object_candidates: list[ObjectType] = []
    relation_candidates: list[RelationType] = []
    preserved_shared: list[str] = []
    preserved_customized: list[str] = []

    for code in sorted(selected_object_codes):
        item = active_objects.get(code)
        if not item:
            continue
        if code in protected_object_codes:
            preserved_shared.append(f"Type d’objet : {item.name}")
        elif not _matches_default_object_type(item):
            preserved_customized.append(f"Type d’objet : {item.name}")
        else:
            object_candidates.append(item)

    for code in sorted(selected_relation_codes):
        item = active_relations.get(code)
        if not item:
            continue
        if code in protected_relation_codes:
            preserved_shared.append(f"Type de relation : {item.name}")
        elif not _matches_default_relation_type(item):
            preserved_customized.append(f"Type de relation : {item.name}")
        else:
            relation_candidates.append(item)

    blockers: list[str] = []
    for item in relation_candidates:
        count = int(db.scalar(select(func.count()).select_from(SIRelation).where(
            SIRelation.relation_type_id == item.id,
            SIRelation.active.is_(True),
        )) or 0)
        if count:
            blockers.append(f"« {item.name} » est utilisé par {count} relation(s)")

    for item in object_candidates:
        object_count = int(db.scalar(select(func.count()).select_from(SIObject).where(
            SIObject.object_type_id == item.id,
            SIObject.active.is_(True),
        )) or 0)
        constraint_count = int(db.scalar(select(func.count()).select_from(RelationType).where(
            RelationType.active.is_(True),
            or_(RelationType.source_type_id == item.id, RelationType.target_type_id == item.id),
        )) or 0)
        if object_count:
            blockers.append(f"« {item.name} » est utilisé par {object_count} objet(s)")
        if constraint_count:
            blockers.append(f"« {item.name} » est référencé par {constraint_count} contrainte(s) de relation")

    if blockers:
        raise HTTPException(
            status_code=409,
            detail="Aucun élément n’a été supprimé. Utilisation détectée : " + " ; ".join(blockers) + ".",
        )

    before = {
        "selected_groups": selected_group_codes,
        "object_type_codes": [item.code for item in object_candidates],
        "relation_type_codes": [item.code for item in relation_candidates],
    }
    # Les relations sont archivées avant les objets pour préserver une lecture cohérente du référentiel.
    for item in relation_candidates:
        item.active = False
    for item in object_candidates:
        item.active = False
    db.flush()
    after = {
        "object_types_archived": len(object_candidates),
        "relation_types_archived": len(relation_candidates),
        "preserved_shared": preserved_shared,
        "preserved_customized": preserved_customized,
    }
    write_audit(db, request, actor, action="archive", entity_type="anssi_templates", entity_id="standard", before=before, after=after)
    db.commit()

    return {
        "message": f"Famille(s) ANSSI retirée(s) : {len(object_candidates)} types d’objets et {len(relation_candidates)} types de relations archivés.",
        "selected_groups": selected_group_codes,
        "object_types_archived": len(object_candidates),
        "relation_types_archived": len(relation_candidates),
        "preserved_shared": preserved_shared,
        "preserved_customized": preserved_customized,
    }
