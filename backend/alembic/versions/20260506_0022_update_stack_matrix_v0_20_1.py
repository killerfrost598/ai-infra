"""Update stack_matrix to vLLM v0.20.1 / sglang v0.5.11; cap Hopper cc_max; add Blackwell row

Revision ID: 20260506_0022
Revises: 20260506_0021
Create Date: 2026-05-06
"""

from alembic import op
import sqlalchemy as sa

revision = "20260506_0022"
down_revision = "20260506_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Row 1 — Legacy (CC 7.0–7.5 / V100, T4): update vllm, drop sglang, update image
    conn.execute(sa.text("""
        UPDATE stack_matrix SET
            vllm = '0.20.1',
            sglang = NULL,
            container_image = 'vllm/vllm-openai:v0.20.1',
            notes = 'Legacy fleet (V100/T4). No FP8, no FA3. sglang requires CC 8.0+.'
        WHERE cc_min = '7.0' AND cc_max = '7.5'
    """))

    # Row 2 — Ampere (CC 8.0–8.6 / A100, RTX 3090): update versions + driver
    conn.execute(sa.text("""
        UPDATE stack_matrix SET
            vllm = '0.20.1',
            sglang = '0.5.11',
            driver_min = '550',
            cuda_runtime = '12.9',
            pip_index_url = 'https://download.pytorch.org/whl/cu128',
            container_image = 'vllm/vllm-openai:v0.20.1',
            notes = 'Ampere (A100, RTX 3090). BF16, no FP8.'
        WHERE cc_min = '8.0' AND cc_max = '8.6'
    """))

    # Row 3 — Ada (CC 8.9 / RTX 4090, L4, L40S): update versions + driver
    conn.execute(sa.text("""
        UPDATE stack_matrix SET
            vllm = '0.20.1',
            sglang = '0.5.11',
            driver_min = '550',
            cuda_runtime = '12.9',
            pip_index_url = 'https://download.pytorch.org/whl/cu128',
            container_image = 'vllm/vllm-openai:v0.20.1',
            notes = 'Ada (RTX 4090, L4, L40S). Native FP8 limited path.'
        WHERE cc_min = '8.9' AND cc_max = '8.9'
    """))

    # Row 4 — Hopper (CC 9.0 / H100, H200): update versions, cap cc_max at 9.0 so Blackwell gets its own row
    conn.execute(sa.text("""
        UPDATE stack_matrix SET
            vllm = '0.20.1',
            sglang = '0.5.11',
            cuda_runtime = '12.9',
            pip_index_url = 'https://download.pytorch.org/whl/cu128',
            container_image = 'vllm/vllm-openai:v0.20.1',
            cc_max = '9.0',
            notes = 'Hopper (H100, H200). Native FP8, FA3 enabled.'
        WHERE cc_min = '9.0' AND cc_max IS NULL
    """))

    # New Row 5 — Blackwell (CC 10.0+ / RTX 5000, B100, B200, RTX PRO 6000)
    conn.execute(sa.text("""
        INSERT INTO stack_matrix
            (cc_min, cc_max, driver_min, cuda_runtime, torch, vllm, sglang,
             container_image, pip_index_url, priority, is_active, notes)
        VALUES
            ('10.0', NULL, '570', '12.9', '2.7.0', '0.20.1', '0.5.11',
             'vllm/vllm-openai:v0.20.1',
             'https://download.pytorch.org/whl/cu128',
             110, TRUE,
             'Blackwell (RTX 5000, B100, B200, RTX PRO 6000). Requires driver >= 570 for CUDA 12.8+ Blackwell support.')
        ON CONFLICT DO NOTHING
    """))


def downgrade() -> None:
    conn = op.get_bind()

    # Remove Blackwell row
    conn.execute(sa.text("DELETE FROM stack_matrix WHERE cc_min = '10.0' AND driver_min = '570'"))

    # Restore Row 4 — Hopper: remove cc_max cap
    conn.execute(sa.text("""
        UPDATE stack_matrix SET
            vllm = '0.7.3', sglang = '0.4.1', driver_min = '550',
            cuda_runtime = '12.4',
            pip_index_url = 'https://download.pytorch.org/whl/cu124',
            container_image = 'vllm/vllm-openai:v0.7.3',
            cc_max = NULL,
            notes = 'Hopper+ (H100, H200). Native FP8, FA3 enabled.'
        WHERE cc_min = '9.0' AND cc_max = '9.0'
    """))

    # Restore Row 3 — Ada
    conn.execute(sa.text("""
        UPDATE stack_matrix SET
            vllm = '0.7.3', sglang = '0.4.1', driver_min = '535',
            cuda_runtime = '12.4',
            pip_index_url = 'https://download.pytorch.org/whl/cu124',
            container_image = 'vllm/vllm-openai:v0.7.3',
            notes = 'Ada (RTX 4090, L4, L40S). FP8 limited path.'
        WHERE cc_min = '8.9' AND cc_max = '8.9'
    """))

    # Restore Row 2 — Ampere
    conn.execute(sa.text("""
        UPDATE stack_matrix SET
            vllm = '0.7.3', sglang = '0.4.1', driver_min = '535',
            cuda_runtime = '12.4',
            pip_index_url = 'https://download.pytorch.org/whl/cu124',
            container_image = 'vllm/vllm-openai:v0.7.3',
            notes = 'Ampere (A100, RTX 3090). BF16, no FP8.'
        WHERE cc_min = '8.0' AND cc_max = '8.6'
    """))

    # Restore Row 1 — Legacy
    conn.execute(sa.text("""
        UPDATE stack_matrix SET
            vllm = '0.6.3', sglang = '0.3.6',
            container_image = 'vllm/vllm-openai:v0.6.3',
            notes = 'Legacy fleet (V100/T4). No FP8, no FA3.'
        WHERE cc_min = '7.0' AND cc_max = '7.5'
    """))
