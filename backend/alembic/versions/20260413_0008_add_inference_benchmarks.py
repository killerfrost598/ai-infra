"""Add inference_benchmarks table (Phase 5C)

Revision ID: 20260413_0008
Revises: 20260413_0007
Create Date: 2026-04-13
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260413_0008"
down_revision = "20260413_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inference_benchmarks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("gpu_model", sa.Text(), nullable=False),
        sa.Column("gpu_vram_gb", sa.Integer(), nullable=True),
        sa.Column("model_name", sa.Text(), nullable=False),
        sa.Column("model_family", sa.Text(), nullable=True),
        sa.Column("quantization", sa.Text(), nullable=True),
        sa.Column("tokens_per_second_avg", sa.Float(), nullable=True),
        sa.Column("tokens_per_second_p95", sa.Float(), nullable=True),
        sa.Column("max_parallel_connections", sa.Integer(), nullable=True),
        sa.Column("vram_used_gb", sa.Float(), nullable=True),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_benchmarks_gpu_model", "inference_benchmarks", ["gpu_model"])
    op.create_index("ix_benchmarks_model_name", "inference_benchmarks", ["model_name"])


def downgrade() -> None:
    op.drop_index("ix_benchmarks_model_name", table_name="inference_benchmarks")
    op.drop_index("ix_benchmarks_gpu_model", table_name="inference_benchmarks")
    op.drop_table("inference_benchmarks")
