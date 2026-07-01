"""Atlas SI v2 modules, saved maps and governance

Revision ID: 0008_v2_modules_maps_governance
Revises: 0007_local_authentication
Create Date: 2026-06-30
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0008_v2_modules_maps_governance"
down_revision: Union[str, None] = "0007_local_authentication"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("si_objects", sa.Column("data_owner_name", sa.String(length=160), nullable=True))
    op.add_column("si_objects", sa.Column("review_status", sa.String(length=32), server_default="draft", nullable=False))
    op.add_column("si_objects", sa.Column("confidence_level", sa.String(length=32), server_default="unknown", nullable=False))
    op.add_column("si_objects", sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("si_objects", sa.Column("next_review_at", sa.Date(), nullable=True))
    op.add_column("si_objects", sa.Column("review_frequency_days", sa.Integer(), nullable=True))
    op.add_column("si_objects", sa.Column("protection_level", sa.String(length=40), server_default="internal", nullable=False))
    op.create_index("ix_si_objects_review_status", "si_objects", ["review_status"], unique=False)
    op.create_index("ix_si_objects_confidence_level", "si_objects", ["confidence_level"], unique=False)
    op.create_index("ix_si_objects_next_review_at", "si_objects", ["next_review_at"], unique=False)

    op.create_table(
        "feature_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("enabled_features", sa.JSON(), nullable=False),
        sa.Column("options", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "saved_maps",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("map_mode", sa.String(length=24), nullable=False),
        sa.Column("visibility", sa.String(length=24), nullable=False),
        sa.Column("group_names", sa.JSON(), nullable=False),
        sa.Column("owner_sub", sa.String(length=255), nullable=False),
        sa.Column("owner_username", sa.String(length=255), nullable=False),
        sa.Column("root_object_ids", sa.JSON(), nullable=False),
        sa.Column("object_type_ids", sa.JSON(), nullable=False),
        sa.Column("relation_type_ids", sa.JSON(), nullable=False),
        sa.Column("direction", sa.String(length=24), nullable=False),
        sa.Column("max_depth", sa.Integer(), nullable=False),
        sa.Column("filters", sa.JSON(), nullable=False),
        sa.Column("layout_mode", sa.String(length=32), nullable=False),
        sa.Column("camera", sa.JSON(), nullable=False),
        sa.Column("positions", sa.JSON(), nullable=False),
        sa.Column("protection_level", sa.String(length=40), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_saved_maps_owner", "saved_maps", ["owner_sub"], unique=False)
    op.create_index("ix_saved_maps_visibility", "saved_maps", ["visibility"], unique=False)
    op.create_index(op.f("ix_saved_maps_active"), "saved_maps", ["active"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_saved_maps_active"), table_name="saved_maps")
    op.drop_index("ix_saved_maps_visibility", table_name="saved_maps")
    op.drop_index("ix_saved_maps_owner", table_name="saved_maps")
    op.drop_table("saved_maps")
    op.drop_table("feature_settings")
    op.drop_index("ix_si_objects_next_review_at", table_name="si_objects")
    op.drop_index("ix_si_objects_confidence_level", table_name="si_objects")
    op.drop_index("ix_si_objects_review_status", table_name="si_objects")
    op.drop_column("si_objects", "protection_level")
    op.drop_column("si_objects", "review_frequency_days")
    op.drop_column("si_objects", "next_review_at")
    op.drop_column("si_objects", "last_reviewed_at")
    op.drop_column("si_objects", "confidence_level")
    op.drop_column("si_objects", "review_status")
    op.drop_column("si_objects", "data_owner_name")
