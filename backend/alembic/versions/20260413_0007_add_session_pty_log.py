"""Add pty_log column to sessions (3C.2 — WebSocket PTY streaming)

Revision ID: 20260413_0007
Revises: 20260413_0006
Create Date: 2026-04-13
"""

import sqlalchemy as sa
from alembic import op

revision = "20260413_0007"
down_revision = "20260413_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("pty_log", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sessions", "pty_log")
