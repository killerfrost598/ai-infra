"""Add metadata_json to sessions

Revision ID: 20260503_0012
Revises: 20260502_0011
Create Date: 2026-05-03
"""

from alembic import op
import sqlalchemy as sa

revision = "20260503_0012"
down_revision = "20260502_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sessions", sa.Column("metadata_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("sessions", "metadata_json")
