"""Expand gpu_profiles: nullable vram_gb, is_full_profile flag

Revision ID: 20260506_0020
Revises: 20260506_0019
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa

revision = "20260506_0020"
down_revision = "20260506_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Allow vram_gb to be NULL for CC-only entries (no VRAM data from the seed)
    op.alter_column("gpu_profiles", "vram_gb", nullable=True)
    # Distinguish full validated profiles (12) from CC-only entries
    op.add_column(
        "gpu_profiles",
        sa.Column("is_full_profile", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    # Mark existing 12 rows as full profiles
    op.execute("UPDATE gpu_profiles SET is_full_profile = TRUE")


def downgrade() -> None:
    op.drop_column("gpu_profiles", "is_full_profile")
    # Restore NOT NULL — fill any NULLs first with 0 to avoid constraint error
    op.execute("UPDATE gpu_profiles SET vram_gb = 0 WHERE vram_gb IS NULL")
    op.alter_column("gpu_profiles", "vram_gb", nullable=False)
