from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.database import Base

JSON_TYPE = JSON().with_variant(JSONB(), "postgresql")


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class ObjectType(Base, TimestampMixin):
    __tablename__ = "object_types"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(64))
    color: Mapped[str | None] = mapped_column(String(16))
    schema: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    objects: Mapped[list[SIObject]] = relationship(back_populates="object_type")


class RelationType(Base, TimestampMixin):
    __tablename__ = "relation_types"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    source_type_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("object_types.id", ondelete="SET NULL"))
    target_type_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("object_types.id", ondelete="SET NULL"))
    directed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    color: Mapped[str | None] = mapped_column(String(16))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    source_type: Mapped[ObjectType | None] = relationship(foreign_keys=[source_type_id])
    target_type: Mapped[ObjectType | None] = relationship(foreign_keys=[target_type_id])
    relations: Mapped[list[SIRelation]] = relationship(back_populates="relation_type")


class SIObject(Base, TimestampMixin):
    __tablename__ = "si_objects"
    __table_args__ = (
        Index("ix_si_objects_type_name", "object_type_id", "name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    external_id: Mapped[str | None] = mapped_column(String(160), unique=True, index=True)
    object_type_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("object_types.id", ondelete="RESTRICT"), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(40), default="active", nullable=False, index=True)
    criticality: Mapped[str] = mapped_column(String(40), default="unknown", nullable=False, index=True)
    owner_name: Mapped[str | None] = mapped_column(String(160))
    data_owner_name: Mapped[str | None] = mapped_column(String(160))
    review_status: Mapped[str] = mapped_column(String(32), default="draft", nullable=False, index=True)
    confidence_level: Mapped[str] = mapped_column(String(32), default="unknown", nullable=False, index=True)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_review_at: Mapped[date | None] = mapped_column(Date, index=True)
    review_frequency_days: Mapped[int | None] = mapped_column(Integer)
    protection_level: Mapped[str] = mapped_column(String(40), default="internal", nullable=False)
    tags: Mapped[dict[str, str]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    object_type: Mapped[ObjectType] = relationship(back_populates="objects")
    outgoing_relations: Mapped[list[SIRelation]] = relationship(
        foreign_keys="SIRelation.source_id", back_populates="source", cascade="all, delete-orphan"
    )
    incoming_relations: Mapped[list[SIRelation]] = relationship(
        foreign_keys="SIRelation.target_id", back_populates="target", cascade="all, delete-orphan"
    )


class SIRelation(Base, TimestampMixin):
    __tablename__ = "si_relations"
    __table_args__ = (
        UniqueConstraint("relation_type_id", "source_id", "target_id", "label", name="uq_relation_identity"),
        Index("ix_relations_source_target", "source_id", "target_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    relation_type_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("relation_types.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    source_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("si_objects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("si_objects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    relation_type: Mapped[RelationType] = relationship(back_populates="relations")
    source: Mapped[SIObject] = relationship(foreign_keys=[source_id], back_populates="outgoing_relations")
    target: Mapped[SIObject] = relationship(foreign_keys=[target_id], back_populates="incoming_relations")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_entity", "entity_type", "entity_id"),
        Index("ix_audit_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    actor_sub: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_username: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_email: Mapped[str | None] = mapped_column(String(320))
    action: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSON_TYPE)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSON_TYPE)
    request_id: Mapped[str | None] = mapped_column(String(64), index=True)
    source_ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(512))




class LocalUser(Base, TimestampMixin):
    __tablename__ = "local_users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(512), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320))
    app_roles: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class AuthSession(Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (Index("ix_auth_sessions_expires_at", "expires_at"),)

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    subject: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320))
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    app_roles: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    keycloak_roles: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    groups: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    csrf_token: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MapPosition(Base, TimestampMixin):
    __tablename__ = "map_positions"
    __table_args__ = (
        UniqueConstraint("user_sub", "view_key", "object_id", name="uq_map_position_user_view_object"),
        Index("ix_map_positions_user_view", "user_sub", "view_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_sub: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    view_key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    object_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("si_objects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)

    object: Mapped[SIObject] = relationship()


class ImportJob(Base, TimestampMixin):
    __tablename__ = "import_jobs"
    __table_args__ = (
        Index("ix_import_jobs_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    entity_kind: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source_format: Mapped[str] = mapped_column(String(16), nullable=False)
    filename: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), default="preview", nullable=False, index=True)
    duplicate_mode: Mapped[str] = mapped_column(String(16), default="skip", nullable=False)
    actor_sub: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    actor_username: Mapped[str] = mapped_column(String(255), nullable=False)
    mapping: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    summary: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    preview_rows: Mapped[list[dict[str, Any]]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    changes: Mapped[list[dict[str, Any]]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rolled_back_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class ImpactScenario(Base, TimestampMixin):
    __tablename__ = "impact_scenarios"
    __table_args__ = (
        Index("ix_impact_scenarios_actor", "actor_sub"),
        Index("ix_impact_scenarios_root", "root_object_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    root_object_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("si_objects.id", ondelete="CASCADE"), nullable=False
    )
    direction: Mapped[str] = mapped_column(String(24), default="both", nullable=False)
    max_depth: Mapped[int] = mapped_column(default=3, nullable=False)
    relation_type_ids: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    excluded_object_ids: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    result_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    actor_sub: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    actor_username: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    root_object: Mapped[SIObject] = relationship()


class VersionObservation(Base, TimestampMixin):
    __tablename__ = "version_observations"
    __table_args__ = (
        Index("ix_version_observations_object_observed", "object_id", "observed_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    object_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("si_objects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    observed_version: Mapped[str | None] = mapped_column(String(160))
    target_version: Mapped[str | None] = mapped_column(String(160))
    latest_version: Mapped[str | None] = mapped_column(String(160))
    support_end_date: Mapped[date | None] = mapped_column(Date)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(120), default="manual", nullable=False, index=True)
    source_reference: Mapped[str | None] = mapped_column(String(255))
    compliance_status: Mapped[str] = mapped_column(String(40), default="unknown", nullable=False, index=True)
    exception_until: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    connector_run_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("connector_runs.id", ondelete="SET NULL"), index=True
    )
    actor_sub: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    actor_username: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    object: Mapped[SIObject] = relationship()
    connector_run: Mapped[ConnectorRun | None] = relationship(back_populates="observations")


class Connector(Base, TimestampMixin):
    __tablename__ = "connectors"
    __table_args__ = (
        UniqueConstraint("name", name="uq_connectors_name"),
        Index("ix_connectors_enabled_next_run", "enabled", "next_run_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    connector_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    source_format: Mapped[str] = mapped_column(String(16), default="json", nullable=False)
    mapping: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    headers: Mapped[dict[str, str]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    schedule_minutes: Mapped[int] = mapped_column(Integer, default=1440, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    last_status: Mapped[str | None] = mapped_column(String(32))
    last_message: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    runs: Mapped[list[ConnectorRun]] = relationship(back_populates="connector", cascade="all, delete-orphan")


class ConnectorRun(Base):
    __tablename__ = "connector_runs"
    __table_args__ = (
        Index("ix_connector_runs_connector_started", "connector_id", "started_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    connector_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("connectors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(32), default="running", nullable=False, index=True)
    triggered_by: Mapped[str] = mapped_column(String(32), default="manual", nullable=False)
    actor_sub: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_username: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    message: Mapped[str | None] = mapped_column(Text)

    connector: Mapped[Connector] = relationship(back_populates="runs")
    observations: Mapped[list[VersionObservation]] = relationship(back_populates="connector_run")


class DesignSettings(Base, TimestampMixin):
    __tablename__ = "design_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    app_title: Mapped[str] = mapped_column(String(120), default="Atlas SI", nullable=False)
    app_subtitle: Mapped[str] = mapped_column(String(180), default="Cartographie du système d’information", nullable=False)
    logo_data_url: Mapped[str | None] = mapped_column(Text)
    theme_mode: Mapped[str] = mapped_column(String(16), default="light", nullable=False)
    primary_color: Mapped[str] = mapped_column(String(16), default="#2563EB", nullable=False)
    accent_color: Mapped[str] = mapped_column(String(16), default="#D4AD42", nullable=False)
    sidebar_color: Mapped[str] = mapped_column(String(16), default="#0F172A", nullable=False)
    background_color: Mapped[str] = mapped_column(String(16), default="#F3F6FB", nullable=False)
    surface_color: Mapped[str] = mapped_column(String(16), default="#FFFFFF", nullable=False)
    border_radius: Mapped[int] = mapped_column(Integer, default=14, nullable=False)
    default_language: Mapped[str] = mapped_column(String(8), default="fr", nullable=False)
    allow_user_language_choice: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class FeatureSettings(Base, TimestampMixin):
    __tablename__ = "feature_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    enabled_features: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    options: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)


class SavedMap(Base, TimestampMixin):
    __tablename__ = "saved_maps"
    __table_args__ = (
        Index("ix_saved_maps_owner", "owner_sub"),
        Index("ix_saved_maps_visibility", "visibility"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    map_mode: Mapped[str] = mapped_column(String(24), default="dynamic", nullable=False)
    visibility: Mapped[str] = mapped_column(String(24), default="private", nullable=False)
    group_names: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    owner_sub: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    owner_username: Mapped[str] = mapped_column(String(255), nullable=False)
    root_object_ids: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    object_type_ids: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    relation_type_ids: Mapped[list[str]] = mapped_column(JSON_TYPE, default=list, nullable=False)
    direction: Mapped[str] = mapped_column(String(24), default="both", nullable=False)
    max_depth: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    filters: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    layout_mode: Mapped[str] = mapped_column(String(32), default="layers", nullable=False)
    camera: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    positions: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    protection_level: Mapped[str] = mapped_column(String(40), default="internal", nullable=False)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON_TYPE, default=dict, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
