"""initial schema

Revision ID: 20260411_0001
Revises:
Create Date: 2026-04-11
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260411_0001"
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        if_not_exists=True,
    )

    op.create_table(
        "provider_accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("provider_name", sa.String(length=64), nullable=False),
        sa.Column("account_label", sa.String(length=255), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        if_not_exists=True,
    )

    op.create_table(
        "servers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("provider_account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("external_server_id", sa.String(length=128), nullable=False, unique=True),
        sa.Column("hostname", sa.String(length=255), nullable=False),
        sa.Column("ssh_port", sa.Integer(), nullable=False, server_default="22"),
        sa.Column("ssh_username", sa.String(length=128), nullable=False),
        sa.Column("gpu_model", sa.String(length=255), nullable=True),
        sa.Column("vram_gb", sa.Integer(), nullable=True),
        sa.Column("cuda_version", sa.String(length=32), nullable=True),
        sa.Column("ram_gb", sa.Integer(), nullable=True),
        sa.Column("network_bandwidth_mbps", sa.Integer(), nullable=True),
        sa.Column("os_image", sa.String(length=255), nullable=True),
        # Define the Enum inline here; SQLAlchemy will create the type automatically
        sa.Column("status", sa.Enum("NEW", "PROVISIONING", "READY", "FAILED", "TERMINATED", name="serverstatus"), nullable=False, server_default="NEW"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["provider_account_id"], ["provider_accounts.id"], ondelete="SET NULL"),
        if_not_exists=True,
    )

    op.create_table(
        "playbooks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("git_repo", sa.String(length=512), nullable=False),
        sa.Column("git_branch", sa.String(length=255), nullable=False, server_default="main"),
        sa.Column("git_commit", sa.String(length=128), nullable=True),
        sa.Column("tags", sa.JSON(), nullable=True),
        sa.Column("requirements_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        if_not_exists=True,
    )

    op.create_table(
        "model_deployments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("playbook_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("model_name", sa.String(length=255), nullable=False),
        sa.Column("model_alias", sa.String(length=255), nullable=True),
        sa.Column("quantization", sa.String(length=64), nullable=True),
        sa.Column("tunnel_local_port", sa.Integer(), nullable=True),
        sa.Column("remote_port", sa.Integer(), nullable=False, server_default="8000"),
        sa.Column("litellm_route_name", sa.String(length=255), nullable=True),
        # Define the Enum inline here
        sa.Column("status", sa.Enum("PENDING", "DEPLOYING", "RUNNING", "FAILED", "STOPPED", name="deploymentstatus"), nullable=False, server_default="PENDING"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["playbook_id"], ["playbooks.id"], ondelete="SET NULL"),
        if_not_exists=True,
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

    op.create_table(
        "task_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("task_type", sa.String(length=128), nullable=False),
        # Define the Enum inline here
        sa.Column("status", sa.Enum("PENDING", "RUNNING", "SUCCESS", "FAILED", "PARTIAL", name="taskstatus"), nullable=False, server_default="PENDING"),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("model_deployment_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("logs_path", sa.String(length=1024), nullable=True),
        sa.Column("error_summary", sa.Text(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["model_deployment_id"], ["model_deployments.id"], ondelete="SET NULL"),
        if_not_exists=True,
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("event_type", sa.String(length=128), nullable=False),
        sa.Column("actor", sa.String(length=255), nullable=False, server_default="system"),
        sa.Column("entity_type", sa.String(length=128), nullable=False),
        sa.Column("entity_id", sa.String(length=128), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        if_not_exists=True,
    )

def downgrade() -> None:
    op.drop_table("audit_logs")
    op.drop_table("task_runs")
    op.drop_table("api_keys")
    op.drop_table("model_deployments")
    op.drop_table("playbooks")
    op.drop_table("servers")
    op.drop_table("provider_accounts")
    op.drop_table("users")

    # Drop the types during downgrade
    sa.Enum(name="taskstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="deploymentstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="serverstatus").drop(op.get_bind(), checkfirst=True)