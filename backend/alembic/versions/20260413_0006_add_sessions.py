"""Add sessions and session_commands tables (3C — SSH Terminal Sessions)

Revision ID: 20260413_0006
Revises: 20260413_0005
Create Date: 2026-04-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260413_0006"
down_revision = "20260413_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent enum creation — DO block swallows duplicate_object errors.
    op.execute(sa.text(
        "DO $$ BEGIN "
        "CREATE TYPE sessionstatus AS ENUM ('ACTIVE', 'TERMINATED'); "
        "EXCEPTION WHEN duplicate_object THEN null; "
        "END $$;"
    ))

    # create_type=False: type already exists, don't emit a second CREATE TYPE.
    sessionstatus_enum = postgresql.ENUM("ACTIVE", "TERMINATED", name="sessionstatus", create_type=False)

    op.create_table(
        "sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "server_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("servers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(255), nullable=True),
        sa.Column(
            "status",
            sessionstatus_enum,
            nullable=False,
            server_default="ACTIVE",
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("terminated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        if_not_exists=True,
    )

    op.create_table(
        "session_commands",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sequence_num", sa.Integer(), nullable=False),
        sa.Column("command", sa.Text(), nullable=False),
        sa.Column("stdout", sa.Text(), nullable=False, server_default=""),
        sa.Column("stderr", sa.Text(), nullable=False, server_default=""),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column(
            "executed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_table("session_commands")
    op.drop_table("sessions")
    sa.Enum(name="sessionstatus").drop(op.get_bind(), checkfirst=True)
