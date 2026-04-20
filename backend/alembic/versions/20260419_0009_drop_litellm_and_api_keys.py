"""Drop litellm_route_name column and api_keys table (ADR-007)

Revision ID: 20260419_0009
Revises: 20260413_0008
Create Date: 2026-04-19
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260419_0009"
down_revision = "20260413_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("model_deployments", "litellm_route_name")
    op.drop_table("api_keys")


def downgrade() -> None:
    op.add_column(
        "model_deployments",
        sa.Column("litellm_route_name", sa.String(length=255), nullable=True),
    )
    op.create_table(
        "api_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("key_name", sa.String(length=255), nullable=False),
        sa.Column("key_prefix", sa.String(length=32), nullable=False),
        sa.Column("provider_name", sa.String(length=64), nullable=True),
        sa.Column("is_revoked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        if_not_exists=True,
    )
