"""Schéma initial Atlas SI - lot 1.

Revision ID: 0001_initial
Revises:
Create Date: 2026-06-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

json_type = postgresql.JSONB(astext_type=sa.Text())


def upgrade() -> None:
    op.create_table(
        "object_types",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("icon", sa.String(length=64), nullable=True),
        sa.Column("color", sa.String(length=16), nullable=True),
        sa.Column("schema", json_type, nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_object_types_active", "object_types", ["active"])
    op.create_index("ix_object_types_code", "object_types", ["code"])

    op.create_table(
        "relation_types",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("source_type_id", sa.Uuid(), nullable=True),
        sa.Column("target_type_id", sa.Uuid(), nullable=True),
        sa.Column("directed", sa.Boolean(), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["source_type_id"], ["object_types.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_type_id"], ["object_types.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_relation_types_active", "relation_types", ["active"])
    op.create_index("ix_relation_types_code", "relation_types", ["code"])

    op.create_table(
        "si_objects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("external_id", sa.String(length=160), nullable=True),
        sa.Column("object_type_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("criticality", sa.String(length=40), nullable=False),
        sa.Column("owner_name", sa.String(length=160), nullable=True),
        sa.Column("tags", json_type, nullable=False),
        sa.Column("attributes", json_type, nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["object_type_id"], ["object_types.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("external_id"),
    )
    op.create_index("ix_si_objects_active", "si_objects", ["active"])
    op.create_index("ix_si_objects_criticality", "si_objects", ["criticality"])
    op.create_index("ix_si_objects_external_id", "si_objects", ["external_id"])
    op.create_index("ix_si_objects_name", "si_objects", ["name"])
    op.create_index("ix_si_objects_object_type_id", "si_objects", ["object_type_id"])
    op.create_index("ix_si_objects_status", "si_objects", ["status"])
    op.create_index("ix_si_objects_type_name", "si_objects", ["object_type_id", "name"])

    op.create_table(
        "si_relations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("relation_type_id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("attributes", json_type, nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["relation_type_id"], ["relation_types.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_id"], ["si_objects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_id"], ["si_objects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("relation_type_id", "source_id", "target_id", "label", name="uq_relation_identity"),
    )
    op.create_index("ix_relations_source_target", "si_relations", ["source_id", "target_id"])
    op.create_index("ix_si_relations_active", "si_relations", ["active"])
    op.create_index("ix_si_relations_relation_type_id", "si_relations", ["relation_type_id"])
    op.create_index("ix_si_relations_source_id", "si_relations", ["source_id"])
    op.create_index("ix_si_relations_target_id", "si_relations", ["target_id"])

    op.create_table(
        "audit_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("actor_sub", sa.String(length=255), nullable=False),
        sa.Column("actor_username", sa.String(length=255), nullable=False),
        sa.Column("actor_email", sa.String(length=320), nullable=True),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("entity_type", sa.String(length=80), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=False),
        sa.Column("before", json_type, nullable=True),
        sa.Column("after", json_type, nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("source_ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_created_at", "audit_events", ["created_at"])
    op.create_index("ix_audit_entity", "audit_events", ["entity_type", "entity_id"])
    op.create_index("ix_audit_events_action", "audit_events", ["action"])
    op.create_index("ix_audit_events_entity_id", "audit_events", ["entity_id"])
    op.create_index("ix_audit_events_entity_type", "audit_events", ["entity_type"])
    op.create_index("ix_audit_events_request_id", "audit_events", ["request_id"])

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("app_roles", json_type, nullable=False),
        sa.Column("keycloak_roles", json_type, nullable=False),
        sa.Column("groups", json_type, nullable=False),
        sa.Column("csrf_token", sa.String(length=128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])
    op.create_index("ix_auth_sessions_subject", "auth_sessions", ["subject"])


def downgrade() -> None:
    op.drop_table("auth_sessions")
    op.drop_table("audit_events")
    op.drop_table("si_relations")
    op.drop_table("si_objects")
    op.drop_table("relation_types")
    op.drop_table("object_types")
