"""Extend inference_benchmarks with TTFT, prefill, concurrency curve, deployment FK

Revision ID: 20260502_0011
Revises: 20260502_0010
Create Date: 2026-05-02
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260502_0011"
down_revision = "20260502_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("inference_benchmarks", sa.Column("ttft_ms_p50", sa.Float(), nullable=True))
    op.add_column("inference_benchmarks", sa.Column("ttft_ms_p95", sa.Float(), nullable=True))
    op.add_column("inference_benchmarks", sa.Column("prefill_tokens_per_second", sa.Float(), nullable=True))
    op.add_column("inference_benchmarks", sa.Column("cold_start_seconds", sa.Integer(), nullable=True))
    op.add_column("inference_benchmarks", sa.Column("concurrency_curve", sa.JSON(), nullable=True))
    op.add_column("inference_benchmarks", sa.Column("knee_concurrency", sa.Integer(), nullable=True))
    op.add_column("inference_benchmarks", sa.Column("profile", sa.String(16), nullable=True))
    op.add_column("inference_benchmarks", sa.Column("deployment_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("inference_benchmarks", sa.Column("task_run_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("inference_benchmarks", sa.Column("model_variant_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(None, "inference_benchmarks", "model_deployments", ["deployment_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key(None, "inference_benchmarks", "task_runs", ["task_run_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key(None, "inference_benchmarks", "model_variants", ["model_variant_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint(None, "inference_benchmarks", type_="foreignkey")
    op.drop_column("inference_benchmarks", "model_variant_id")
    op.drop_column("inference_benchmarks", "task_run_id")
    op.drop_column("inference_benchmarks", "deployment_id")
    op.drop_column("inference_benchmarks", "profile")
    op.drop_column("inference_benchmarks", "knee_concurrency")
    op.drop_column("inference_benchmarks", "concurrency_curve")
    op.drop_column("inference_benchmarks", "cold_start_seconds")
    op.drop_column("inference_benchmarks", "prefill_tokens_per_second")
    op.drop_column("inference_benchmarks", "ttft_ms_p95")
    op.drop_column("inference_benchmarks", "ttft_ms_p50")
