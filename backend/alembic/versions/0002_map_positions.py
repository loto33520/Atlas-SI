"""Positions personnelles des cartes - lot 2.

Revision ID: 0002_map_positions
Revises: 0001_initial
Create Date: 2026-06-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_map_positions"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "map_positions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_sub", sa.String(length=255), nullable=False),
        sa.Column("view_key", sa.String(length=80), nullable=False),
        sa.Column("object_id", sa.Uuid(), nullable=False),
        sa.Column("x", sa.Float(), nullable=False),
        sa.Column("y", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["object_id"], ["si_objects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_sub", "view_key", "object_id", name="uq_map_position_user_view_object"),
    )
    op.create_index("ix_map_positions_object_id", "map_positions", ["object_id"])
    op.create_index("ix_map_positions_user_sub", "map_positions", ["user_sub"])
    op.create_index("ix_map_positions_view_key", "map_positions", ["view_key"])
    op.create_index("ix_map_positions_user_view", "map_positions", ["user_sub", "view_key"])


def downgrade() -> None:
    op.drop_table("map_positions")
