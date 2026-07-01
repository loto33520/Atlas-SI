"""Imports CSV et JSON - lot 3.

Revision ID: 0003_import_jobs
Revises: 0002_map_positions
Create Date: 2026-06-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0003_import_jobs"
down_revision: Union[str, None] = "0002_map_positions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    json_type = postgresql.JSONB(astext_type=sa.Text())
    op.create_table(
        "import_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("entity_kind", sa.String(length=32), nullable=False),
        sa.Column("source_format", sa.String(length=16), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("duplicate_mode", sa.String(length=16), nullable=False),
        sa.Column("actor_sub", sa.String(length=255), nullable=False),
        sa.Column("actor_username", sa.String(length=255), nullable=False),
        sa.Column("mapping", json_type, nullable=False),
        sa.Column("summary", json_type, nullable=False),
        sa.Column("preview_rows", json_type, nullable=False),
        sa.Column("changes", json_type, nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_import_jobs_created_at", "import_jobs", ["created_at"])
    op.create_index("ix_import_jobs_status", "import_jobs", ["status"])
    op.create_index("ix_import_jobs_actor_sub", "import_jobs", ["actor_sub"])
    op.create_index("ix_import_jobs_entity_kind", "import_jobs", ["entity_kind"])


def downgrade() -> None:
    op.drop_table("import_jobs")
