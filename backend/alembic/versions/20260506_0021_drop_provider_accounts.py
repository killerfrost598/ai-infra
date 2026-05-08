"""Drop provider_accounts table and servers.provider_account_id FK (single-operator app)

Revision ID: 20260506_0021
Revises: 20260506_0020
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260506_0021"
down_revision = "20260506_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("servers_provider_account_id_fkey", "servers", type_="foreignkey")
    op.drop_column("servers", "provider_account_id")
    op.drop_table("provider_accounts")


def downgrade() -> None:
    op.create_table(
        "provider_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("provider_name", sa.String(length=64), nullable=False),
        sa.Column("account_label", sa.String(length=255), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.add_column(
        "servers",
        sa.Column("provider_account_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "servers_provider_account_id_fkey",
        "servers", "provider_accounts",
        ["provider_account_id"], ["id"],
        ondelete="SET NULL",
    )
