"""Add extended HF metadata fields to models and model_quants

Revision ID: 20260505_0017
Revises: 20260504_0016
Create Date: 2026-05-05
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260505_0017"
down_revision = "20260504_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── models: HF metadata + taxonomy fields ─────────────────────────────────
    op.add_column("models", sa.Column("org", sa.String(64), nullable=True))
    op.add_column("models", sa.Column("architecture", sa.String(128), nullable=True))
    op.add_column("models", sa.Column("pipeline_tag", sa.String(64), nullable=True))
    op.add_column("models", sa.Column("library_name", sa.String(64), nullable=True))
    op.add_column("models", sa.Column("license", sa.String(64), nullable=True))
    op.add_column("models", sa.Column("languages", postgresql.JSON, nullable=True))
    op.add_column("models", sa.Column("gated", sa.String(16), nullable=True))
    op.add_column("models", sa.Column("base_model", sa.String(255), nullable=True))
    op.add_column("models", sa.Column("hf_downloads", sa.Integer, nullable=True))
    op.add_column("models", sa.Column("hf_likes", sa.Integer, nullable=True))
    op.add_column("models", sa.Column("hf_trending_score", sa.Float, nullable=True))
    op.add_column("models", sa.Column("hf_last_modified", sa.DateTime(timezone=True), nullable=True))
    op.add_column("models", sa.Column("hf_created_at", sa.DateTime(timezone=True), nullable=True))

    op.create_index("ix_models_org", "models", ["org"], if_not_exists=True)
    op.create_index("ix_models_hf_downloads", "models", ["hf_downloads"], if_not_exists=True)
    op.create_index("ix_models_hf_trending_score", "models", ["hf_trending_score"], if_not_exists=True)

    # ── model_quants: quant format + HF stats ─────────────────────────────────
    op.add_column("model_quants", sa.Column(
        "quant_format", sa.String(16), nullable=False, server_default="unknown"
    ))
    op.add_column("model_quants", sa.Column("quant_variant", sa.String(32), nullable=True))
    op.add_column("model_quants", sa.Column("safetensors_dtypes", postgresql.JSON, nullable=True))
    op.add_column("model_quants", sa.Column(
        "tags", postgresql.JSON, nullable=False, server_default="[]"
    ))
    op.add_column("model_quants", sa.Column("library_name", sa.String(64), nullable=True))
    op.add_column("model_quants", sa.Column("gated", sa.String(16), nullable=True))
    op.add_column("model_quants", sa.Column("hf_downloads", sa.Integer, nullable=True))
    op.add_column("model_quants", sa.Column("hf_likes", sa.Integer, nullable=True))

    op.create_index("ix_model_quants_quant_format", "model_quants", ["quant_format"], if_not_exists=True)


def downgrade() -> None:
    op.drop_index("ix_model_quants_quant_format", table_name="model_quants", if_exists=True)
    op.drop_index("ix_models_hf_trending_score", table_name="models", if_exists=True)
    op.drop_index("ix_models_hf_downloads", table_name="models", if_exists=True)
    op.drop_index("ix_models_org", table_name="models", if_exists=True)

    op.drop_column("model_quants", "hf_likes")
    op.drop_column("model_quants", "hf_downloads")
    op.drop_column("model_quants", "gated")
    op.drop_column("model_quants", "library_name")
    op.drop_column("model_quants", "tags")
    op.drop_column("model_quants", "safetensors_dtypes")
    op.drop_column("model_quants", "quant_variant")
    op.drop_column("model_quants", "quant_format")

    op.drop_column("models", "hf_created_at")
    op.drop_column("models", "hf_last_modified")
    op.drop_column("models", "hf_trending_score")
    op.drop_column("models", "hf_likes")
    op.drop_column("models", "hf_downloads")
    op.drop_column("models", "base_model")
    op.drop_column("models", "gated")
    op.drop_column("models", "languages")
    op.drop_column("models", "license")
    op.drop_column("models", "library_name")
    op.drop_column("models", "pipeline_tag")
    op.drop_column("models", "architecture")
    op.drop_column("models", "org")
