"""Add playbook_run_outcomes table

Revision ID: 20260503_0014
Revises: 20260503_0013
Create Date: 2026-05-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260503_0014"
down_revision = "20260503_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "playbook_run_outcomes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "playbook_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("playbooks.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "task_run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("task_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "server_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("servers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "model_variant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("model_variants.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("gpu_model", sa.String(255), nullable=True, index=True),
        sa.Column("succeeded", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("playbook_run_outcomes")
