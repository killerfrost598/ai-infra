"""add inference proxy routes and metrics

Revision ID: 20260515_0026
Revises: 20260514_0025
Create Date: 2026-05-15 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "20260515_0026"
down_revision = "20260514_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inference_proxy_routes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("route_slug", sa.String(length=96), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("quant_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("model_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("model_name", sa.String(length=255), nullable=False),
        sa.Column("target_base_url", sa.String(length=512), nullable=False),
        sa.Column("remote_port", sa.Integer(), nullable=False),
        sa.Column("profile_json", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("hourly_cost_usd", sa.Float(), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["model_id"], ["models.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["model_run_id"], ["model_run_attempts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["quant_id"], ["model_quants.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("route_slug", name="uq_inference_proxy_routes_route_slug"),
    )
    op.create_index("ix_inference_proxy_routes_model_run_id", "inference_proxy_routes", ["model_run_id"])
    op.create_index("ix_inference_proxy_routes_server_id", "inference_proxy_routes", ["server_id"])
    op.create_index("ix_inference_proxy_routes_server_status", "inference_proxy_routes", ["server_id", "status"])
    op.create_index("ix_inference_proxy_routes_session_id", "inference_proxy_routes", ["session_id"])
    op.create_index("ix_inference_proxy_routes_status", "inference_proxy_routes", ["status"])

    op.create_table(
        "inference_proxy_metrics",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("route_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("server_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("model_run_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False),
        sa.Column("path", sa.String(length=512), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("ttft_ms", sa.Integer(), nullable=True),
        sa.Column("tokens_per_second", sa.Float(), nullable=True),
        sa.Column("estimated_cost_usd", sa.Float(), nullable=True),
        sa.Column("effectiveness_score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["model_run_id"], ["model_run_attempts.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["route_id"], ["inference_proxy_routes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_inference_proxy_metrics_model_run_id", "inference_proxy_metrics", ["model_run_id"])
    op.create_index("ix_inference_proxy_metrics_route_created", "inference_proxy_metrics", ["route_id", "created_at"])
    op.create_index("ix_inference_proxy_metrics_route_id", "inference_proxy_metrics", ["route_id"])
    op.create_index("ix_inference_proxy_metrics_server_created", "inference_proxy_metrics", ["server_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_inference_proxy_metrics_server_created", table_name="inference_proxy_metrics")
    op.drop_index("ix_inference_proxy_metrics_route_id", table_name="inference_proxy_metrics")
    op.drop_index("ix_inference_proxy_metrics_route_created", table_name="inference_proxy_metrics")
    op.drop_index("ix_inference_proxy_metrics_model_run_id", table_name="inference_proxy_metrics")
    op.drop_table("inference_proxy_metrics")

    op.drop_index("ix_inference_proxy_routes_status", table_name="inference_proxy_routes")
    op.drop_index("ix_inference_proxy_routes_session_id", table_name="inference_proxy_routes")
    op.drop_index("ix_inference_proxy_routes_server_status", table_name="inference_proxy_routes")
    op.drop_index("ix_inference_proxy_routes_server_id", table_name="inference_proxy_routes")
    op.drop_index("ix_inference_proxy_routes_model_run_id", table_name="inference_proxy_routes")
    op.drop_table("inference_proxy_routes")
