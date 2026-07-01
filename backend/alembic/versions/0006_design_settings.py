"""design settings

Revision ID: 0006_design_settings
Revises: 0005_versions_connectors
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_design_settings"
down_revision = "0005_versions_connectors"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "design_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("app_title", sa.String(length=120), nullable=False, server_default="Atlas SI"),
        sa.Column("app_subtitle", sa.String(length=180), nullable=False, server_default="Cartographie du système d’information"),
        sa.Column("logo_data_url", sa.Text(), nullable=True),
        sa.Column("theme_mode", sa.String(length=16), nullable=False, server_default="light"),
        sa.Column("primary_color", sa.String(length=16), nullable=False, server_default="#2563EB"),
        sa.Column("accent_color", sa.String(length=16), nullable=False, server_default="#D4AD42"),
        sa.Column("sidebar_color", sa.String(length=16), nullable=False, server_default="#0F172A"),
        sa.Column("background_color", sa.String(length=16), nullable=False, server_default="#F3F6FB"),
        sa.Column("surface_color", sa.String(length=16), nullable=False, server_default="#FFFFFF"),
        sa.Column("border_radius", sa.Integer(), nullable=False, server_default="14"),
        sa.Column("default_language", sa.String(length=8), nullable=False, server_default="fr"),
        sa.Column("allow_user_language_choice", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.execute("""
      INSERT INTO design_settings
      (id, app_title, app_subtitle, theme_mode, primary_color, accent_color, sidebar_color, background_color, surface_color, border_radius, default_language, allow_user_language_choice)
      VALUES (1, 'Atlas SI', 'Cartographie du système d’information', 'light', '#2563EB', '#D4AD42', '#0F172A', '#F3F6FB', '#FFFFFF', 14, 'fr', true)
    """)


def downgrade() -> None:
    op.drop_table("design_settings")
