"""Allow encrypted server credential values.

Revision ID: 20260514_0025
Revises: 20260514_0024
Create Date: 2026-05-14
"""

from alembic import op
import sqlalchemy as sa

revision = "20260514_0025"
down_revision = "20260514_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("servers", "ssh_password", type_=sa.Text(), existing_nullable=True)


def downgrade() -> None:
    op.alter_column("servers", "ssh_password", type_=sa.String(length=255), existing_nullable=True)
