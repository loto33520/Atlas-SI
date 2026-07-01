from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

CODE_RE = re.compile(r"^[a-z][a-z0-9_-]{1,63}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class APIMessage(BaseModel):
    message: str


class ObjectTypeBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None
    icon: str | None = Field(default=None, max_length=64)
    color: str | None = Field(default=None, max_length=16)
    field_schema: dict[str, Any] = Field(default_factory=dict, alias="schema", serialization_alias="schema")
    active: bool = True

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not CODE_RE.match(normalized):
            raise ValueError("Le code doit commencer par une lettre et ne contenir que a-z, 0-9, _ ou -.")
        return normalized

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str | None) -> str | None:
        if value and not COLOR_RE.match(value):
            raise ValueError("La couleur doit être au format #RRGGBB.")
        return value

    @field_validator("field_schema")
    @classmethod
    def validate_field_schema(cls, value: dict[str, Any]) -> dict[str, Any]:
        fields = value.get("fields")
        if fields is None:
            return value
        if not isinstance(fields, list):
            raise ValueError("Le champ schema.fields doit être une liste.")
        seen: set[str] = set()
        allowed_types = {"text", "number", "boolean", "date", "select"}
        for field in fields:
            if not isinstance(field, dict):
                raise ValueError("Chaque champ configurable doit être un objet.")
            key = str(field.get("key", "")).strip()
            label = str(field.get("label", "")).strip()
            field_type = str(field.get("type", "text"))
            if not key or not CODE_RE.match(key):
                raise ValueError("La clé d'un champ configurable doit respecter le format des codes.")
            if key in seen:
                raise ValueError(f"La clé de champ « {key} » est déclarée plusieurs fois.")
            if not label:
                raise ValueError(f"Le champ « {key} » doit avoir un libellé.")
            if field_type not in allowed_types:
                raise ValueError(f"Le type du champ « {key} » n'est pas pris en charge.")
            if field_type == "select" and not isinstance(field.get("options", []), list):
                raise ValueError(f"Les options du champ « {key} » doivent être une liste.")
            seen.add(key)
        return value


class ObjectTypeCreate(ObjectTypeBase):
    pass


class ObjectTypeUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str | None = Field(default=None, min_length=2, max_length=64)
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = None
    icon: str | None = Field(default=None, max_length=64)
    color: str | None = Field(default=None, max_length=16)
    field_schema: dict[str, Any] | None = Field(default=None, alias="schema", serialization_alias="schema")
    active: bool | None = None

    _validate_code = field_validator("code")(ObjectTypeBase.validate_code.__func__)
    _validate_color = field_validator("color")(ObjectTypeBase.validate_color.__func__)
    _validate_field_schema = field_validator("field_schema")(ObjectTypeBase.validate_field_schema.__func__)


class ObjectTypeRead(ObjectTypeBase):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    id: uuid.UUID
    object_count: int = 0
    active_object_count: int = 0
    created_at: datetime
    updated_at: datetime


class RelationTypeBase(BaseModel):
    code: str = Field(min_length=2, max_length=64)
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None
    source_type_id: uuid.UUID | None = None
    target_type_id: uuid.UUID | None = None
    directed: bool = True
    color: str | None = Field(default=None, max_length=16)
    active: bool = True

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        return ObjectTypeBase.validate_code(value)

    @field_validator("color")
    @classmethod
    def validate_color(cls, value: str | None) -> str | None:
        return ObjectTypeBase.validate_color(value)


class RelationTypeCreate(RelationTypeBase):
    pass


class RelationTypeUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=2, max_length=64)
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = None
    source_type_id: uuid.UUID | None = None
    target_type_id: uuid.UUID | None = None
    directed: bool | None = None
    color: str | None = Field(default=None, max_length=16)
    active: bool | None = None

    _validate_code = field_validator("code")(RelationTypeBase.validate_code.__func__)
    _validate_color = field_validator("color")(RelationTypeBase.validate_color.__func__)


class RelationTypeRead(RelationTypeBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class SIObjectBase(BaseModel):
    external_id: str | None = Field(default=None, max_length=160)
    object_type_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    status: str = Field(default="active", min_length=1, max_length=40)
    criticality: str = Field(default="unknown", min_length=1, max_length=40)
    owner_name: str | None = Field(default=None, max_length=160)
    data_owner_name: str | None = Field(default=None, max_length=160)
    review_status: str = Field(default="draft", pattern="^(draft|validated|outdated)$")
    confidence_level: str = Field(default="unknown", pattern="^(unknown|estimated|confirmed)$")
    last_reviewed_at: datetime | None = None
    next_review_at: date | None = None
    review_frequency_days: int | None = Field(default=None, ge=1, le=3650)
    protection_level: str = Field(default="internal", pattern="^(public|internal|confidential|restricted)$")
    tags: dict[str, str] = Field(default_factory=dict)
    attributes: dict[str, Any] = Field(default_factory=dict)
    active: bool = True

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, value: dict[str, str]) -> dict[str, str]:
        result: dict[str, str] = {}
        for key, item in value.items():
            normalized_key = key.strip().lower()
            if not normalized_key or len(normalized_key) > 80:
                raise ValueError("Chaque clé d'étiquette doit contenir entre 1 et 80 caractères.")
            result[normalized_key] = str(item).strip()
        return result


class SIObjectCreate(SIObjectBase):
    pass


class SIObjectUpdate(BaseModel):
    external_id: str | None = Field(default=None, max_length=160)
    object_type_id: uuid.UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    status: str | None = Field(default=None, min_length=1, max_length=40)
    criticality: str | None = Field(default=None, min_length=1, max_length=40)
    owner_name: str | None = Field(default=None, max_length=160)
    data_owner_name: str | None = Field(default=None, max_length=160)
    review_status: str | None = Field(default=None, pattern="^(draft|validated|outdated)$")
    confidence_level: str | None = Field(default=None, pattern="^(unknown|estimated|confirmed)$")
    last_reviewed_at: datetime | None = None
    next_review_at: date | None = None
    review_frequency_days: int | None = Field(default=None, ge=1, le=3650)
    protection_level: str | None = Field(default=None, pattern="^(public|internal|confidential|restricted)$")
    tags: dict[str, str] | None = None
    attributes: dict[str, Any] | None = None
    active: bool | None = None

    _normalize_tags = field_validator("tags")(SIObjectBase.normalize_tags.__func__)


class SIObjectRead(SIObjectBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class SIRelationBase(BaseModel):
    relation_type_id: uuid.UUID
    source_id: uuid.UUID
    target_id: uuid.UUID
    label: str = Field(default="", max_length=160)
    attributes: dict[str, Any] = Field(default_factory=dict)
    active: bool = True


class SIRelationCreate(SIRelationBase):
    pass


class SIRelationUpdate(BaseModel):
    relation_type_id: uuid.UUID | None = None
    source_id: uuid.UUID | None = None
    target_id: uuid.UUID | None = None
    label: str | None = Field(default=None, max_length=160)
    attributes: dict[str, Any] | None = None
    active: bool | None = None


class SIRelationRead(SIRelationBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class AuditEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    created_at: datetime
    actor_sub: str
    actor_username: str
    actor_email: EmailStr | None
    action: str
    entity_type: str
    entity_id: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    request_id: str | None
    source_ip: str | None
    user_agent: str | None


class AuthConfigRead(BaseModel):
    mode: str
    local_username_hint: str | None = None


class LocalLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=512)
    next: str | None = Field(default=None, max_length=2048)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.strip().casefold()


class CurrentUserRead(BaseModel):
    subject: str
    username: str
    email: EmailStr | None
    display_name: str
    roles: list[str]
    groups: list[str]
    csrf_token: str


class DashboardRead(BaseModel):
    object_types: int
    relation_types: int
    objects: int
    relations: int
    recent_audit_events: int


class MapNodeRead(BaseModel):
    id: uuid.UUID
    external_id: str | None
    name: str
    description: str | None
    status: str
    criticality: str
    owner_name: str | None
    data_owner_name: str | None = None
    review_status: str = "draft"
    confidence_level: str = "unknown"
    last_reviewed_at: datetime | None = None
    next_review_at: date | None = None
    review_frequency_days: int | None = None
    protection_level: str = "internal"
    tags: dict[str, str]
    attributes: dict[str, Any]
    object_type_id: uuid.UUID
    object_type_code: str
    object_type_name: str
    color: str
    icon: str | None
    x: float | None = None
    y: float | None = None


class MapEdgeRead(BaseModel):
    id: uuid.UUID
    source_id: uuid.UUID
    target_id: uuid.UUID
    relation_type_id: uuid.UUID
    relation_type_code: str
    relation_type_name: str
    label: str
    color: str
    directed: bool
    attributes: dict[str, Any]


class MapTypeLegendRead(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    color: str
    icon: str | None
    count: int


class MapTagFilterRead(BaseModel):
    key: str
    values: list[str]


class MapGraphRead(BaseModel):
    view: str
    nodes: list[MapNodeRead]
    edges: list[MapEdgeRead]
    legends: list[MapTypeLegendRead]
    available_tags: list[MapTagFilterRead]
    total_nodes: int
    total_edges: int
    truncated: bool = False


class MapPositionItem(BaseModel):
    object_id: uuid.UUID
    x: float = Field(ge=-100000, le=100000)
    y: float = Field(ge=-100000, le=100000)


class MapPositionsUpdate(BaseModel):
    view_key: str = Field(min_length=1, max_length=80)
    positions: list[MapPositionItem] = Field(max_length=2000)


class MapQueryRequest(BaseModel):
    root_object_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    object_type_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    relation_type_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    direction: str = Field(default="both", pattern="^(upstream|downstream|both)$")
    max_depth: int = Field(default=2, ge=0, le=20)
    q: str | None = Field(default=None, max_length=200)
    criticalities: list[str] = Field(default_factory=list, max_length=20)
    statuses: list[str] = Field(default_factory=list, max_length=20)
    tags: list[str] = Field(default_factory=list, max_length=100)
    limit: int = Field(default=1200, ge=1, le=5000)
    position_view_key: str = Field(default="custom", min_length=1, max_length=80)


class MapPreviewRead(BaseModel):
    total_nodes: int
    total_edges: int
    truncated: bool
    max_depth_reached: int


class MapCatalogRead(BaseModel):
    object_types: list[ObjectTypeRead]
    relation_types: list[RelationTypeRead]
    max_recursion_depth: int
    max_displayed_nodes: int


class SavedMapBase(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    description: str | None = None
    map_mode: str = Field(default="dynamic", pattern="^(dynamic|snapshot)$")
    visibility: str = Field(default="private", pattern="^(private|all|groups)$")
    group_names: list[str] = Field(default_factory=list, max_length=100)
    root_object_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    object_type_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    relation_type_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    direction: str = Field(default="both", pattern="^(upstream|downstream|both)$")
    max_depth: int = Field(default=2, ge=0, le=20)
    filters: dict[str, Any] = Field(default_factory=dict)
    layout_mode: str = Field(default="layers", max_length=32)
    camera: dict[str, Any] = Field(default_factory=dict)
    positions: dict[str, Any] = Field(default_factory=dict)
    protection_level: str = Field(default="internal", pattern="^(public|internal|confidential|restricted)$")


class SavedMapCreate(SavedMapBase):
    snapshot: dict[str, Any] = Field(default_factory=dict)


class SavedMapUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=180)
    description: str | None = None
    map_mode: str | None = Field(default=None, pattern="^(dynamic|snapshot)$")
    visibility: str | None = Field(default=None, pattern="^(private|all|groups)$")
    group_names: list[str] | None = None
    root_object_ids: list[uuid.UUID] | None = None
    object_type_ids: list[uuid.UUID] | None = None
    relation_type_ids: list[uuid.UUID] | None = None
    direction: str | None = Field(default=None, pattern="^(upstream|downstream|both)$")
    max_depth: int | None = Field(default=None, ge=0, le=20)
    filters: dict[str, Any] | None = None
    layout_mode: str | None = Field(default=None, max_length=32)
    camera: dict[str, Any] | None = None
    positions: dict[str, Any] | None = None
    protection_level: str | None = Field(default=None, pattern="^(public|internal|confidential|restricted)$")
    snapshot: dict[str, Any] | None = None
    active: bool | None = None


class SavedMapRead(SavedMapBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    owner_sub: str
    owner_username: str
    snapshot: dict[str, Any]
    active: bool
    created_at: datetime
    updated_at: datetime


class FeatureDefinitionRead(BaseModel):
    code: str
    name_fr: str
    name_en: str
    description_fr: str
    description_en: str
    maturity_level: int
    category: str
    dependencies: list[str]
    toggleable: bool
    enabled: bool


class FeatureSettingsRead(BaseModel):
    enabled_features: list[str]
    options: dict[str, Any]
    features: list[FeatureDefinitionRead]
    updated_at: datetime | None = None


class FeatureSettingsUpdate(BaseModel):
    enabled_features: list[str] = Field(default_factory=list, max_length=100)
    options: dict[str, Any] = Field(default_factory=dict)


class AnssiTemplateGroupRead(BaseModel):
    code: str
    name_fr: str
    name_en: str
    description_fr: str
    description_en: str
    object_type_codes: list[str]
    relation_type_codes: list[str]
    installed_object_types: int = 0
    installed_relation_types: int = 0
    status: str = "not_installed"


class AnssiTemplateCatalogRead(BaseModel):
    groups: list[AnssiTemplateGroupRead]


class AnssiTemplateInstallRequest(BaseModel):
    groups: list[str] = Field(default_factory=list, max_length=20)


class AnssiTemplateInstallRead(BaseModel):
    message: str
    selected_groups: list[str]
    object_types_created: int
    relation_types_created: int
    object_types_reactivated: int = 0
    relation_types_reactivated: int = 0


class AnssiTemplateUninstallRead(BaseModel):
    message: str
    selected_groups: list[str]
    object_types_archived: int
    relation_types_archived: int
    preserved_shared: list[str] = Field(default_factory=list)
    preserved_customized: list[str] = Field(default_factory=list)


class ImportAnalyseRequest(BaseModel):
    entity_kind: str = Field(pattern="^(objects|relations)$")
    source_format: str = Field(pattern="^(csv|json)$")
    content: str = Field(min_length=1, max_length=8_000_000)
    filename: str | None = Field(default=None, max_length=255)
    delimiter: str | None = Field(default=None, min_length=1, max_length=1)


class ImportAnalyseRead(BaseModel):
    columns: list[str]
    sample: list[dict[str, Any]]
    suggested_mapping: dict[str, str]
    row_count: int


class ImportPreviewRequest(ImportAnalyseRequest):
    mapping: dict[str, str] = Field(default_factory=dict)
    duplicate_mode: str = Field(default="skip", pattern="^(skip|update|error)$")


class ImportPreviewRowRead(BaseModel):
    row_number: int
    status: str
    action: str
    identity: str
    message: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class ImportJobRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    entity_kind: str
    source_format: str
    filename: str | None
    status: str
    duplicate_mode: str
    actor_sub: str
    actor_username: str
    mapping: dict[str, Any]
    summary: dict[str, Any]
    preview_rows: list[dict[str, Any]]
    changes: list[dict[str, Any]]
    applied_at: datetime | None
    rolled_back_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ImportJobSummaryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    entity_kind: str
    source_format: str
    filename: str | None
    status: str
    duplicate_mode: str
    actor_sub: str
    actor_username: str
    summary: dict[str, Any]
    applied_at: datetime | None
    rolled_back_at: datetime | None
    created_at: datetime
    updated_at: datetime

class ImpactAnalysisRequest(BaseModel):
    root_object_id: uuid.UUID
    direction: str = Field(default="both", pattern="^(upstream|downstream|both)$")
    max_depth: int = Field(default=3, ge=1, le=10)
    relation_type_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    excluded_object_ids: list[uuid.UUID] = Field(default_factory=list, max_length=1000)


class ImpactNodeRead(BaseModel):
    id: uuid.UUID
    name: str
    object_type_code: str
    object_type_name: str
    criticality: str
    owner_name: str | None
    depth: int
    paths_count: int
    impact_score: int
    is_root: bool = False


class ImpactEdgeRead(BaseModel):
    id: uuid.UUID
    source_id: uuid.UUID
    target_id: uuid.UUID
    relation_type_id: uuid.UUID
    relation_type_name: str
    label: str
    directed: bool


class ImpactPathRead(BaseModel):
    node_ids: list[uuid.UUID]
    relation_ids: list[uuid.UUID]
    depth: int


class ImpactCycleRead(BaseModel):
    node_ids: list[uuid.UUID]
    relation_ids: list[uuid.UUID]


class ImpactSummaryRead(BaseModel):
    total_nodes: int
    total_edges: int
    max_depth_reached: int
    by_type: dict[str, int]
    by_criticality: dict[str, int]
    owners: list[str]
    has_cycles: bool


class ImpactAnalysisRead(BaseModel):
    root_object_id: uuid.UUID
    direction: str
    max_depth: int
    nodes: list[ImpactNodeRead]
    edges: list[ImpactEdgeRead]
    paths: list[ImpactPathRead]
    cycles: list[ImpactCycleRead]
    summary: ImpactSummaryRead


class ImpactScenarioCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    description: str | None = None
    analysis: ImpactAnalysisRequest
    result_snapshot: dict[str, Any] = Field(default_factory=dict)


class ImpactScenarioRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    description: str | None
    root_object_id: uuid.UUID
    direction: str
    max_depth: int
    relation_type_ids: list[str]
    excluded_object_ids: list[str]
    result_snapshot: dict[str, Any]
    actor_sub: str
    actor_username: str
    active: bool
    created_at: datetime
    updated_at: datetime


class VersionObservationCreate(BaseModel):
    object_id: uuid.UUID
    observed_version: str | None = Field(default=None, max_length=160)
    target_version: str | None = Field(default=None, max_length=160)
    latest_version: str | None = Field(default=None, max_length=160)
    support_end_date: date | None = None
    observed_at: datetime | None = None
    source: str = Field(default="manual", min_length=1, max_length=120)
    source_reference: str | None = Field(default=None, max_length=255)
    compliance_status: str | None = Field(default=None, max_length=40)
    exception_until: date | None = None
    notes: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class VersionObservationUpdate(BaseModel):
    observed_version: str | None = Field(default=None, max_length=160)
    target_version: str | None = Field(default=None, max_length=160)
    latest_version: str | None = Field(default=None, max_length=160)
    support_end_date: date | None = None
    observed_at: datetime | None = None
    source: str | None = Field(default=None, min_length=1, max_length=120)
    source_reference: str | None = Field(default=None, max_length=255)
    compliance_status: str | None = Field(default=None, max_length=40)
    exception_until: date | None = None
    notes: str | None = None
    details: dict[str, Any] | None = None
    active: bool | None = None


class VersionObservationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    object_id: uuid.UUID
    observed_version: str | None
    target_version: str | None
    latest_version: str | None
    support_end_date: date | None
    observed_at: datetime
    source: str
    source_reference: str | None
    compliance_status: str
    exception_until: date | None
    notes: str | None
    details: dict[str, Any]
    connector_run_id: uuid.UUID | None
    actor_sub: str
    actor_username: str
    active: bool
    created_at: datetime
    updated_at: datetime


class VersionCurrentRead(VersionObservationRead):
    object_name: str
    object_type_name: str
    owner_name: str | None
    criticality: str


class VersionSummaryRead(BaseModel):
    total: int
    by_status: dict[str, int]
    unsupported: int
    update_available: int
    up_to_date: int
    unknown: int
    exceptions: int
    expiring_within_90_days: int


class ConnectorBase(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    description: str | None = None
    connector_type: str = Field(default="http_versions", pattern="^http_versions$")
    url: str = Field(min_length=8, max_length=1000)
    source_format: str = Field(default="json", pattern="^(json|csv)$")
    mapping: dict[str, str] = Field(default_factory=dict)
    headers: dict[str, str] = Field(default_factory=dict)
    schedule_minutes: int = Field(default=1440, ge=5, le=525600)
    enabled: bool = False
    active: bool = True


class ConnectorCreate(ConnectorBase):
    pass


class ConnectorUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = None
    connector_type: str | None = Field(default=None, pattern="^http_versions$")
    url: str | None = Field(default=None, min_length=8, max_length=1000)
    source_format: str | None = Field(default=None, pattern="^(json|csv)$")
    mapping: dict[str, str] | None = None
    headers: dict[str, str] | None = None
    schedule_minutes: int | None = Field(default=None, ge=5, le=525600)
    enabled: bool | None = None
    active: bool | None = None


class ConnectorRead(ConnectorBase):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    last_run_at: datetime | None
    next_run_at: datetime | None
    last_status: str | None
    last_message: str | None
    created_at: datetime
    updated_at: datetime


class ConnectorRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    connector_id: uuid.UUID
    started_at: datetime
    finished_at: datetime | None
    status: str
    triggered_by: str
    actor_sub: str
    actor_username: str
    summary: dict[str, Any]
    message: str | None


class ConnectorRunRequest(BaseModel):
    dry_run: bool = False


class DesignSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    app_title: str
    app_subtitle: str
    logo_data_url: str | None
    theme_mode: str
    primary_color: str
    accent_color: str
    sidebar_color: str
    background_color: str
    surface_color: str
    border_radius: int
    default_language: str
    allow_user_language_choice: bool
    updated_at: datetime | None = None


class DesignSettingsUpdate(BaseModel):
    app_title: str = Field(min_length=2, max_length=120)
    app_subtitle: str = Field(default="", max_length=180)
    theme_mode: str = Field(default="light", pattern="^(light|dark|system)$")
    primary_color: str = Field(default="#2563EB", pattern=r"^#[0-9a-fA-F]{6}$")
    accent_color: str = Field(default="#D4AD42", pattern=r"^#[0-9a-fA-F]{6}$")
    sidebar_color: str = Field(default="#0F172A", pattern=r"^#[0-9a-fA-F]{6}$")
    background_color: str = Field(default="#F3F6FB", pattern=r"^#[0-9a-fA-F]{6}$")
    surface_color: str = Field(default="#FFFFFF", pattern=r"^#[0-9a-fA-F]{6}$")
    border_radius: int = Field(default=14, ge=0, le=30)
    default_language: str = Field(default="fr", pattern="^(fr|en)$")
    allow_user_language_choice: bool = True


class LogoUpload(BaseModel):
    data_url: str = Field(min_length=30, max_length=2_200_000)


class QualityIssueRead(BaseModel):
    code: str
    severity: str
    object_id: uuid.UUID | None = None
    object_name: str | None = None
    object_type: str | None = None
    message_fr: str
    message_en: str


class QualitySummaryRead(BaseModel):
    score: int
    total_issues: int
    critical: int
    warning: int
    information: int
    by_code: dict[str, int]
