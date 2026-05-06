"""Add author classification columns to models and model_quants; index model_quants(model_id, quant_format)

Revision ID: 20260506_0019
Revises: 20260506_0018
Create Date: 2026-05-06
"""

import sqlalchemy as sa
from alembic import op

revision = "20260506_0019"
down_revision = "20260506_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("models", sa.Column("author", sa.String(128), nullable=True))
    op.add_column("models", sa.Column("author_class", sa.String(16), nullable=True))
    op.add_column("models", sa.Column("author_label", sa.String(128), nullable=True))
    op.add_column("models", sa.Column("author_url", sa.String(255), nullable=True))

    op.add_column("model_quants", sa.Column("author", sa.String(128), nullable=True))
    op.add_column("model_quants", sa.Column("author_class", sa.String(16), nullable=True))
    op.add_column("model_quants", sa.Column("author_label", sa.String(128), nullable=True))
    op.add_column("model_quants", sa.Column("author_url", sa.String(255), nullable=True))

    # Backfill: derive author from org (already stored in models.org)
    op.execute(sa.text("""
        UPDATE models
        SET
            author       = org,
            author_class = 'private',
            author_label = org,
            author_url   = 'https://huggingface.co/' || org
        WHERE org IS NOT NULL AND author IS NULL
    """))

    # Backfill quants from their parent model's author
    op.execute(sa.text("""
        UPDATE model_quants mq
        SET
            author       = m.author,
            author_class = m.author_class,
            author_label = m.author_label,
            author_url   = m.author_url
        FROM models m
        WHERE mq.model_id = m.id AND mq.author IS NULL
    """))

    # Composite index for the excluded_quant_formats EXISTS subquery
    op.create_index(
        "ix_model_quants_model_id_quant_format",
        "model_quants",
        ["model_id", "quant_format"],
    )


def downgrade() -> None:
    op.drop_index("ix_model_quants_model_id_quant_format", table_name="model_quants")

    for col in ("author_url", "author_label", "author_class", "author"):
        op.drop_column("model_quants", col)
        op.drop_column("models", col)
