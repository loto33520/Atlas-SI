"""Analyse des dépendances et scénarios - lot 4.

Revision ID: 0004_impact_scenarios
Revises: 0003_import_jobs
Create Date: 2026-06-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0004_impact_scenarios"
down_revision: Union[str, None] = "0003_import_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    json_type = postgresql.JSONB(astext_type=sa.Text())
    op.create_table(
        "impact_scenarios",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("root_object_id", sa.Uuid(), nullable=False),
        sa.Column("direction", sa.String(length=24), nullable=False),
        sa.Column("max_depth", sa.Integer(), nullable=False),
        sa.Column("relation_type_ids", json_type, nullable=False),
        sa.Column("excluded_object_ids", json_type, nullable=False),
        sa.Column("result_snapshot", json_type, nullable=False),
        sa.Column("actor_sub", sa.String(length=255), nullable=False),
        sa.Column("actor_username", sa.String(length=255), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["root_object_id"], ["si_objects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_impact_scenarios_actor", "impact_scenarios", ["actor_sub"])
    op.create_index("ix_impact_scenarios_root", "impact_scenarios", ["root_object_id"])
    op.create_index("ix_impact_scenarios_active", "impact_scenarios", ["active"])


def downgrade() -> None:
    op.drop_table("impact_scenarios")
