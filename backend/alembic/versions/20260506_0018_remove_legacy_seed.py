"""Remove models seeded from the legacy JSON catalog (source='imported')

Revision ID: 20260506_0018
Revises: 20260505_0017
Create Date: 2026-05-06
"""

import sqlalchemy as sa
from alembic import op

revision = "20260506_0018"
down_revision = "20260505_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    result = conn.execute(
        sa.text("SELECT COUNT(*) FROM models WHERE source = 'imported'")
    )
    count = result.scalar() or 0
    if count:
        # Quants cascade-delete via FK ondelete=CASCADE
        conn.execute(sa.text("DELETE FROM models WHERE source = 'imported'"))
        print(f"[0018] removed {count} legacy imported models")
    else:
        print("[0018] no imported models found — nothing to remove")


def downgrade() -> None:
    # Deleted rows cannot be restored; the JSON seed file has been removed.
    print("[0018] downgrade is a no-op — legacy data cannot be restored")
