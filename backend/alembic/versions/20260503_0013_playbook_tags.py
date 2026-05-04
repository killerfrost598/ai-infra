"""Tag playbooks with model_variant_id, engine, source_session_id

Revision ID: 20260503_0013
Revises: 20260503_0012
Create Date: 2026-05-03
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260503_0013"
down_revision = "20260503_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "playbooks",
        sa.Column(
            "model_variant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("model_variants.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "playbooks",
        sa.Column(
            "engine",
            sa.Enum("VLLM", "SGLANG", "OLLAMA", name="enginekind", create_type=False),
            nullable=True,
        ),
    )
    op.add_column(
        "playbooks",
        sa.Column(
            "source_session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("playbooks", "source_session_id")
    op.drop_column("playbooks", "engine")
    op.drop_column("playbooks", "model_variant_id")
