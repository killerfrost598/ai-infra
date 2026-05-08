"""Add model_run_attempts table for Lab test-run capture

Revision ID: 20260506_0023
Revises: 20260506_0022
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260506_0023"
down_revision = "20260506_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create new enum types (enginekind already exists from prior migrations)
    op.execute("CREATE TYPE runstatus AS ENUM ('PLANNED', 'RUNNING', 'SUCCESS', 'FAILED', 'ABANDONED')")
    op.execute("CREATE TYPE failurestage AS ENUM ('PLAN', 'IMAGE_PULL', 'OOM', 'CC_MISMATCH', 'CUDA_MISMATCH', 'TIMEOUT', 'HEALTH_CHECK', 'OTHER')")

    op.create_table(
        "model_run_attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("servers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("models.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("model_quants.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("host_snapshot_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("host_capability_snapshots.id", ondelete="SET NULL"), nullable=True),
        sa.Column("task_run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("task_runs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("engine", postgresql.ENUM(name="enginekind", create_type=False), nullable=False),
        sa.Column("engine_version", sa.String(32), nullable=True),
        sa.Column("mode", sa.String(16), nullable=False, server_default="container"),
        sa.Column("container_image", sa.String(255), nullable=True),
        sa.Column("container_id", sa.String(128), nullable=True),
        sa.Column("launch_command", sa.Text, nullable=False, server_default=""),
        sa.Column("launch_plan_json", sa.JSON, nullable=True),
        sa.Column("feasibility_verdict", sa.String(16), nullable=False, server_default="UNKNOWN"),
        sa.Column("forced", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("status", postgresql.ENUM(name="runstatus", create_type=False), nullable=False, server_default="PLANNED"),
        sa.Column("succeeded", sa.Boolean, nullable=True),
        sa.Column("failure_stage", postgresql.ENUM(name="failurestage", create_type=False), nullable=True),
        sa.Column("failure_message", sa.Text, nullable=True),
        sa.Column("ttft_ms", sa.Float, nullable=True),
        sa.Column("tps_steady", sa.Float, nullable=True),
        sa.Column("vram_used_gb", sa.Float, nullable=True),
        sa.Column("health_check_url", sa.String(512), nullable=True),
        sa.Column("health_check_ok", sa.Boolean, nullable=True),
        sa.Column("operator_notes", sa.Text, nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer, nullable=True),
        sa.Column("published_url", sa.String(512), nullable=True),
        sa.Column("published_sha", sa.String(128), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_model_run_attempts_server_id", "model_run_attempts", ["server_id"])
    op.create_index("ix_model_run_attempts_session_id", "model_run_attempts", ["session_id"])
    op.create_index("ix_model_run_attempts_model_id", "model_run_attempts", ["model_id"])
    op.create_index("ix_model_run_attempts_quant_id", "model_run_attempts", ["quant_id"])
    op.create_index("ix_runs_server_started", "model_run_attempts", ["server_id", "started_at"])
    op.create_index("ix_runs_model_quant_succeeded", "model_run_attempts", ["model_id", "quant_id", "succeeded"])


def downgrade() -> None:
    op.drop_index("ix_runs_model_quant_succeeded", "model_run_attempts")
    op.drop_index("ix_runs_server_started", "model_run_attempts")
    op.drop_index("ix_model_run_attempts_quant_id", "model_run_attempts")
    op.drop_index("ix_model_run_attempts_model_id", "model_run_attempts")
    op.drop_index("ix_model_run_attempts_session_id", "model_run_attempts")
    op.drop_index("ix_model_run_attempts_server_id", "model_run_attempts")
    op.drop_table("model_run_attempts")
    op.execute("DROP TYPE IF EXISTS runstatus")
    op.execute("DROP TYPE IF EXISTS failurestage")
