"""Compat stack Phase 1: gpu_profiles, stack_matrix, model_variants, host_capability_snapshots

Revision ID: 20260502_0010
Revises: 20260419_0009
Create Date: 2026-05-02
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260502_0010"
down_revision = "20260419_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "gpu_profiles",
        sa.Column("model_key", sa.String(64), primary_key=True),
        sa.Column("display_name", sa.String(128), nullable=False),
        sa.Column("aliases", sa.JSON(), nullable=True),
        sa.Column("arch", sa.String(32), nullable=False),
        sa.Column("cc", sa.String(8), nullable=False),
        sa.Column("vram_gb", sa.Integer(), nullable=False),
        sa.Column("fp8_native", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("bf16", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("marlin", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("fa2", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("fa3", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    op.create_table(
        "stack_matrix",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("cc_min", sa.String(8), nullable=False),
        sa.Column("cc_max", sa.String(8), nullable=True),
        sa.Column("driver_min", sa.String(16), nullable=False),
        sa.Column("cuda_runtime", sa.String(16), nullable=False),
        sa.Column("torch", sa.String(32), nullable=False),
        sa.Column("vllm", sa.String(32), nullable=True),
        sa.Column("sglang", sa.String(32), nullable=True),
        sa.Column("container_image", sa.String(255), nullable=True),
        sa.Column("pip_index_url", sa.String(255), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("100")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "model_variants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("model_key", sa.String(128), nullable=False, index=True),
        sa.Column("quant", sa.String(32), nullable=False),
        sa.Column("vram_min_gb", sa.Integer(), nullable=False),
        sa.Column("cc_min", sa.String(8), nullable=False),
        sa.Column("arch_supported_vllm", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("arch_supported_sglang", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("num_attention_heads", sa.Integer(), nullable=True),
        sa.Column("tp_allowed_sizes", sa.JSON(), nullable=True),
        sa.Column("context_default", sa.Integer(), nullable=False, server_default=sa.text("8192")),
        sa.Column("hf_repo", sa.String(255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
    )

    op.create_table(
        "host_capability_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("servers.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("driver_version", sa.String(32), nullable=True),
        sa.Column("cuda_runtime_host", sa.String(16), nullable=True),
        sa.Column("gpu_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("gpus", sa.JSON(), nullable=True),
        sa.Column("nvlink_topology", sa.Text(), nullable=True),
        sa.Column("homogeneous", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("docker_present", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("nvidia_container_toolkit", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("raw_outputs", sa.JSON(), nullable=True),
    )

    # Create enginekind enum type
    enginekind_enum = sa.Enum("VLLM", "SGLANG", "OLLAMA", name="enginekind")
    enginekind_enum.create(op.get_bind(), checkfirst=True)

    # Add nullable columns to model_deployments
    op.add_column("model_deployments", sa.Column("engine", sa.Enum("VLLM", "SGLANG", "OLLAMA", name="enginekind"), nullable=True))
    op.add_column("model_deployments", sa.Column("model_variant_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("model_deployments", sa.Column("stack_matrix_id", sa.Integer(), nullable=True))
    op.add_column("model_deployments", sa.Column("install_plan_json", sa.JSON(), nullable=True))
    op.add_column("model_deployments", sa.Column("inference_base_url", sa.String(512), nullable=True))

    op.create_foreign_key(None, "model_deployments", "model_variants", ["model_variant_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key(None, "model_deployments", "stack_matrix", ["stack_matrix_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint(None, "model_deployments", type_="foreignkey")
    op.drop_column("model_deployments", "inference_base_url")
    op.drop_column("model_deployments", "install_plan_json")
    op.drop_column("model_deployments", "stack_matrix_id")
    op.drop_column("model_deployments", "model_variant_id")
    op.drop_column("model_deployments", "engine")
    op.drop_table("host_capability_snapshots")
    op.drop_table("model_variants")
    op.drop_table("stack_matrix")
    op.drop_table("gpu_profiles")
    sa.Enum(name="enginekind").drop(op.get_bind(), checkfirst=True)
