from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import FeatureSettings


@dataclass(frozen=True)
class FeatureDefinition:
    code: str
    name_fr: str
    name_en: str
    description_fr: str
    description_en: str
    maturity_level: int
    category: str
    dependencies: tuple[str, ...] = ()
    toggleable: bool = True


FEATURE_DEFINITIONS: tuple[FeatureDefinition, ...] = (
    FeatureDefinition(
        "map", "Cartographie interactive", "Interactive mapping",
        "Construit des cartes dynamiques à partir des objets et relations du référentiel.",
        "Builds dynamic maps from repository objects and relationships.",
        1, "cartography",
    ),
    FeatureDefinition(
        "saved_maps", "Cartes enregistrées", "Saved maps",
        "Enregistre des vues dynamiques ou des instantanés partageables et exportables.",
        "Saves dynamic views or shareable and exportable snapshots.",
        2, "cartography", ("map",),
    ),
    FeatureDefinition(
        "impact_analysis", "Analyse d’impact", "Impact analysis",
        "Parcourt les dépendances en amont et en aval et permet de simuler des exclusions.",
        "Traverses upstream and downstream dependencies and simulates exclusions.",
        2, "analysis", ("map",),
    ),
    FeatureDefinition(
        "versions", "Versions et obsolescence", "Versions and obsolescence",
        "Suit les versions observées, cibles, fins de support et exceptions.",
        "Tracks observed and target versions, end-of-support dates and exceptions.",
        2, "lifecycle",
    ),
    FeatureDefinition(
        "map_version_details", "Versions dans la fiche cartographique", "Versions in map details",
        "Affiche la dernière observation de version dans le panneau de détail de la carte.",
        "Shows the latest version observation in the map details panel.",
        2, "cartography", ("map", "versions"),
    ),
    FeatureDefinition(
        "imports", "Imports CSV et JSON", "CSV and JSON imports",
        "Importe en masse des objets et relations avec aperçu et annulation.",
        "Bulk imports objects and relationships with preview and rollback.",
        1, "data",
    ),
    FeatureDefinition(
        "quality", "Qualité et audit de complétude", "Quality and completeness audit",
        "Contrôle les informations manquantes, les éléments isolés et les données obsolètes.",
        "Checks missing information, isolated elements and stale data.",
        2, "governance",
    ),
    FeatureDefinition(
        "governance", "Gouvernance et revues", "Governance and reviews",
        "Ajoute la validation, le niveau de confiance, la fréquence et les échéances de revue.",
        "Adds validation, confidence level, review frequency and review due dates.",
        3, "governance", ("quality",),
    ),
    FeatureDefinition(
        "audit", "Historique détaillé", "Detailed audit trail",
        "Expose l’historique avant/après des opérations aux profils habilités.",
        "Exposes before/after operation history to authorised profiles.",
        2, "governance",
    ),
    FeatureDefinition(
        "anssi_templates", "Modèles ANSSI", "ANSSI templates",
        "Ajoute à la demande les modèles écosystème, administration, infrastructure logique et physique.",
        "Optionally installs ecosystem, administration, logical and physical infrastructure templates.",
        2, "templates",
    ),
)

FEATURE_BY_CODE = {item.code: item for item in FEATURE_DEFINITIONS}
ALL_FEATURE_CODES = set(FEATURE_BY_CODE)
MINIMAL_FEATURES = {"map"}
COMPLETE_FEATURES = set(ALL_FEATURE_CODES)


def normalized_features(values: list[str] | set[str]) -> list[str]:
    selected = {value for value in values if value in ALL_FEATURE_CODES}
    changed = True
    while changed:
        changed = False
        for code in tuple(selected):
            for dependency in FEATURE_BY_CODE[code].dependencies:
                if dependency not in selected:
                    selected.add(dependency)
                    changed = True
    return sorted(selected)


def get_feature_settings(db: Session, profile: str = "complete") -> FeatureSettings:
    item = db.get(FeatureSettings, 1)
    if item is None:
        enabled = MINIMAL_FEATURES if profile == "minimal" else COMPLETE_FEATURES
        item = FeatureSettings(id=1, enabled_features=normalized_features(enabled), options={})
        db.add(item)
        db.flush()
    return item


def feature_payload(db: Session, profile: str = "complete") -> dict[str, Any]:
    settings = get_feature_settings(db, profile)
    enabled = set(settings.enabled_features or [])
    return {
        "enabled_features": sorted(enabled),
        "options": settings.options or {},
        "features": [
            {
                "code": definition.code,
                "name_fr": definition.name_fr,
                "name_en": definition.name_en,
                "description_fr": definition.description_fr,
                "description_en": definition.description_en,
                "maturity_level": definition.maturity_level,
                "category": definition.category,
                "dependencies": list(definition.dependencies),
                "toggleable": definition.toggleable,
                "enabled": definition.code in enabled,
            }
            for definition in FEATURE_DEFINITIONS
        ],
        "updated_at": settings.updated_at,
    }


def is_feature_enabled(db: Session, code: str, profile: str = "complete") -> bool:
    settings = get_feature_settings(db, profile)
    return code in set(settings.enabled_features or [])
