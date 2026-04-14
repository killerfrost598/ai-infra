"""Add platform_settings table (3B — DB-backed configuration)

Revision ID: 20260413_0005
Revises: 20260413_0004
Create Date: 2026-04-13
"""

from alembic import op
import sqlalchemy as sa

revision = "20260413_0005"
down_revision = "20260413_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "platform_settings",
        sa.Column("key", sa.String(128), primary_key=True, nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_table("platform_settings")
