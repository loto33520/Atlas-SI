"""Suivi des versions et connecteurs planifiés - lot 5.

Revision ID: 0005_versions_connectors
Revises: 0004_impact_scenarios
Create Date: 2026-06-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0005_versions_connectors"
down_revision: Union[str, None] = "0004_impact_scenarios"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    json_type = postgresql.JSONB(astext_type=sa.Text())
    op.create_table(
        "connectors",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("connector_type", sa.String(length=32), nullable=False),
        sa.Column("url", sa.String(length=1000), nullable=False),
        sa.Column("source_format", sa.String(length=16), nullable=False),
        sa.Column("mapping", json_type, nullable=False),
        sa.Column("headers", json_type, nullable=False),
        sa.Column("schedule_minutes", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(length=32), nullable=True),
        sa.Column("last_message", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_connectors_name"),
    )
    op.create_index("ix_connectors_connector_type", "connectors", ["connector_type"])
    op.create_index("ix_connectors_enabled", "connectors", ["enabled"])
    op.create_index("ix_connectors_next_run_at", "connectors", ["next_run_at"])
    op.create_index("ix_connectors_active", "connectors", ["active"])
    op.create_index("ix_connectors_enabled_next_run", "connectors", ["enabled", "next_run_at"])

    op.create_table(
        "connector_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("connector_id", sa.Uuid(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("triggered_by", sa.String(length=32), nullable=False),
        sa.Column("actor_sub", sa.String(length=255), nullable=False),
        sa.Column("actor_username", sa.String(length=255), nullable=False),
        sa.Column("summary", json_type, nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["connector_id"], ["connectors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_connector_runs_connector_id", "connector_runs", ["connector_id"])
    op.create_index("ix_connector_runs_status", "connector_runs", ["status"])
    op.create_index("ix_connector_runs_connector_started", "connector_runs", ["connector_id", "started_at"])

    op.create_table(
        "version_observations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("object_id", sa.Uuid(), nullable=False),
        sa.Column("observed_version", sa.String(length=160), nullable=True),
        sa.Column("target_version", sa.String(length=160), nullable=True),
        sa.Column("latest_version", sa.String(length=160), nullable=True),
        sa.Column("support_end_date", sa.Date(), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=120), nullable=False),
        sa.Column("source_reference", sa.String(length=255), nullable=True),
        sa.Column("compliance_status", sa.String(length=40), nullable=False),
        sa.Column("exception_until", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("details", json_type, nullable=False),
        sa.Column("connector_run_id", sa.Uuid(), nullable=True),
        sa.Column("actor_sub", sa.String(length=255), nullable=False),
        sa.Column("actor_username", sa.String(length=255), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["object_id"], ["si_objects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["connector_run_id"], ["connector_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_version_observations_object_id", "version_observations", ["object_id"])
    op.create_index("ix_version_observations_observed_at", "version_observations", ["observed_at"])
    op.create_index("ix_version_observations_source", "version_observations", ["source"])
    op.create_index("ix_version_observations_compliance_status", "version_observations", ["compliance_status"])
    op.create_index("ix_version_observations_connector_run_id", "version_observations", ["connector_run_id"])
    op.create_index("ix_version_observations_actor_sub", "version_observations", ["actor_sub"])
    op.create_index("ix_version_observations_active", "version_observations", ["active"])
    op.create_index("ix_version_observations_object_observed", "version_observations", ["object_id", "observed_at"])


def downgrade() -> None:
    op.drop_table("version_observations")
    op.drop_table("connector_runs")
    op.drop_table("connectors")
