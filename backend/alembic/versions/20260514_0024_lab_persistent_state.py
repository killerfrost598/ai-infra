"""Add persisted Lab server state and model cache records.

Revision ID: 20260514_0024
Revises: 20260506_0023
Create Date: 2026-05-14
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260514_0024"
down_revision = "20260506_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lab_server_state",
        sa.Column("server_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True, nullable=False),
        sa.Column("initialized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("vllm_installed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("vllm_version", sa.String(64), nullable=True),
        sa.Column("vllm_help_flags", sa.JSON(), nullable=True),
        sa.Column("active_model_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("models.id", ondelete="SET NULL"), nullable=True),
        sa.Column("active_quant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("model_quants.id", ondelete="SET NULL"), nullable=True),
        sa.Column("active_model_repo", sa.String(255), nullable=True),
        sa.Column("active_port", sa.Integer(), nullable=True),
        sa.Column("active_endpoint", sa.String(512), nullable=True),
        sa.Column("active_profile_json", sa.JSON(), nullable=True),
        sa.Column("active_health_ok", sa.Boolean(), nullable=True),
        sa.Column("active_task_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("task_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("active_model_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("model_run_attempts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("active_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_successful_profile_json", sa.JSON(), nullable=True),
        sa.Column("last_failed_profile_json", sa.JSON(), nullable=True),
        sa.Column("last_failure_kind", sa.String(64), nullable=True),
        sa.Column("last_failure_reason", sa.Text(), nullable=True),
        sa.Column("last_failure_diagnosis_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "lab_model_caches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("servers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("models.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("model_quants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("repo_id", sa.String(255), nullable=False),
        sa.Column("cache_path", sa.String(1024), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="unknown"),
        sa.Column("total_bytes", sa.Integer(), nullable=True),
        sa.Column("cached_bytes", sa.Integer(), nullable=True),
        sa.Column("last_download_task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("task_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("server_id", "model_id", "quant_id", "repo_id", name="uq_lab_model_cache_repo"),
    )
    op.create_index("ix_lab_model_caches_server_id", "lab_model_caches", ["server_id"])
    op.create_index("ix_lab_model_caches_model_id", "lab_model_caches", ["model_id"])
    op.create_index("ix_lab_model_caches_quant_id", "lab_model_caches", ["quant_id"])
    op.create_index("ix_lab_model_caches_server_status", "lab_model_caches", ["server_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_lab_model_caches_server_status", "lab_model_caches")
    op.drop_index("ix_lab_model_caches_quant_id", "lab_model_caches")
    op.drop_index("ix_lab_model_caches_model_id", "lab_model_caches")
    op.drop_index("ix_lab_model_caches_server_id", "lab_model_caches")
    op.drop_table("lab_model_caches")
    op.drop_table("lab_server_state")
