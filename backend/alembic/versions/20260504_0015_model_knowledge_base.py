"""Add models and model_quants tables

Revision ID: 20260504_0015
Revises: 20260503_0014
Create Date: 2026-05-04
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260504_0015"
down_revision = "20260503_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "models",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("model_key", sa.String(128), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("family", sa.String(64), nullable=False),
        sa.Column("param_count_b", sa.Float, nullable=False),
        sa.Column("hf_url", sa.String(512), nullable=True),
        sa.Column("hf_repo", sa.String(255), nullable=True),
        sa.Column("max_context_k", sa.Integer, nullable=False),
        sa.Column("tags", postgresql.JSON, nullable=False, server_default="[]"),
        sa.Column("use_case", sa.String(64), nullable=False, server_default="chat"),
        sa.Column("is_reasoning", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("supports_tools", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_code_model", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_moe", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("moe_active_params_b", sa.Float, nullable=True),
        sa.Column("num_attention_heads", sa.Integer, nullable=True),
        sa.Column("tp_allowed_sizes", postgresql.JSON, nullable=True),
        sa.Column("kv_cache", postgresql.JSON, nullable=False, server_default="{}"),
        sa.Column("recommended_engines", postgresql.JSON, nullable=False, server_default="[]"),
        sa.Column("recommended_flags", postgresql.JSON, nullable=False, server_default="{}"),
        sa.Column("source", sa.String(32), nullable=False, server_default="manual"),
        sa.Column("hf_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_archived", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        if_not_exists=True,
    )
    op.create_index("ix_models_model_key", "models", ["model_key"], unique=True, if_not_exists=True)
    op.create_index("ix_models_family", "models", ["family"], if_not_exists=True)

    op.create_table(
        "model_quants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "model_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("models.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("hf_repo", sa.String(255), nullable=True),
        sa.Column("hf_url", sa.String(512), nullable=True),
        sa.Column("bits_per_weight", sa.Float, nullable=False),
        sa.Column("disk_size_gb", sa.Float, nullable=False),
        sa.Column("vram_weights_gb", sa.Float, nullable=False),
        sa.Column("quality_score", sa.Float, nullable=False, server_default="1.0"),
        sa.Column("cc_min", sa.String(8), nullable=True),
        sa.Column("arch_vllm", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("arch_sglang", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("model_id", "name", name="uq_model_quants_model_name"),
        if_not_exists=True,
    )
    op.create_index("ix_model_quants_model_id", "model_quants", ["model_id"], if_not_exists=True)


def downgrade() -> None:
    op.drop_table("model_quants", if_exists=True)
    op.drop_table("models", if_exists=True)
