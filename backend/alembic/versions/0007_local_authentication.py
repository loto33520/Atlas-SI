"""add local authentication users

Revision ID: 0007_local_authentication
Revises: 0006_design_settings
Create Date: 2026-06-29
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0007_local_authentication"
down_revision: Union[str, None] = "0006_design_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "local_users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("username", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.String(length=512), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("app_roles", sa.JSON(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username"),
    )
    op.create_index(op.f("ix_local_users_username"), "local_users", ["username"], unique=True)
    op.create_index(op.f("ix_local_users_active"), "local_users", ["active"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_local_users_active"), table_name="local_users")
    op.drop_index(op.f("ix_local_users_username"), table_name="local_users")
    op.drop_table("local_users")
