"""Seed models and model_quants from initial_models.json

Revision ID: 20260504_0016
Revises: 20260504_0015
Create Date: 2026-05-04
"""

import json
import pathlib
import uuid as _uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "20260504_0016"
down_revision = "20260504_0015"
branch_labels = None
depends_on = None

_SEED_FILE = pathlib.Path(__file__).parent.parent.parent / "seeds" / "models.json"


def upgrade() -> None:
    if not _SEED_FILE.exists():
        print(f"[seed] {_SEED_FILE} not found — skipping model seed")
        return

    with open(_SEED_FILE, encoding="utf-8") as f:
        catalog = json.load(f)

    conn = op.get_bind()
    models_table = sa.table(
        "models",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("model_key", sa.String),
        sa.column("name", sa.String),
        sa.column("family", sa.String),
        sa.column("param_count_b", sa.Float),
        sa.column("hf_url", sa.String),
        sa.column("hf_repo", sa.String),
        sa.column("max_context_k", sa.Integer),
        sa.column("tags", sa.JSON),
        sa.column("use_case", sa.String),
        sa.column("is_reasoning", sa.Boolean),
        sa.column("supports_tools", sa.Boolean),
        sa.column("is_code_model", sa.Boolean),
        sa.column("is_moe", sa.Boolean),
        sa.column("moe_active_params_b", sa.Float),
        sa.column("num_attention_heads", sa.Integer),
        sa.column("tp_allowed_sizes", sa.JSON),
        sa.column("kv_cache", sa.JSON),
        sa.column("recommended_engines", sa.JSON),
        sa.column("recommended_flags", sa.JSON),
        sa.column("source", sa.String),
    )
    quants_table = sa.table(
        "model_quants",
        sa.column("id", UUID(as_uuid=True)),
        sa.column("model_id", UUID(as_uuid=True)),
        sa.column("name", sa.String),
        sa.column("bits_per_weight", sa.Float),
        sa.column("disk_size_gb", sa.Float),
        sa.column("vram_weights_gb", sa.Float),
        sa.column("quality_score", sa.Float),
        sa.column("cc_min", sa.String),
        sa.column("arch_vllm", sa.Boolean),
        sa.column("arch_sglang", sa.Boolean),
        sa.column("notes", sa.String),
    )

    for entry in catalog.get("models", []):
        model_id = _uuid.uuid4()
        # derive hf_repo from huggingface_url
        hf_url = entry.get("huggingface_url", "")
        hf_repo = None
        if "huggingface.co/" in hf_url:
            parts = hf_url.split("huggingface.co/", 1)
            if len(parts) == 2:
                hf_repo = parts[1].strip("/")

        conn.execute(
            models_table.insert().values(
                id=model_id,
                model_key=entry["id"],
                name=entry["name"],
                family=entry["family"],
                param_count_b=entry["param_count_b"],
                hf_url=hf_url or None,
                hf_repo=hf_repo,
                max_context_k=int(entry.get("max_context_k", 8)),
                tags=entry.get("tags", []),
                use_case=entry.get("use_case", "chat"),
                is_reasoning=bool(entry.get("is_reasoning", False)),
                supports_tools=bool(entry.get("supports_tools", False)),
                is_code_model=bool(entry.get("is_code_model", False)),
                is_moe=bool(entry.get("is_moe", False)),
                moe_active_params_b=entry.get("moe_active_params_b"),
                num_attention_heads=entry.get("num_attention_heads"),
                tp_allowed_sizes=entry.get("tp_allowed_sizes"),
                kv_cache=entry.get("kv_cache", {}),
                recommended_engines=entry.get("recommended_engines", []),
                recommended_flags=entry.get("recommended_flags", {}),
                source="imported",
            )
        )

        for q in entry.get("quants", []):
            conn.execute(
                quants_table.insert().values(
                    id=_uuid.uuid4(),
                    model_id=model_id,
                    name=q["name"],
                    bits_per_weight=float(q["bits_per_weight"]),
                    disk_size_gb=float(q["disk_size_gb"]),
                    vram_weights_gb=float(q["vram_weights_gb"]),
                    quality_score=float(q.get("quality_score", 1.0)),
                    cc_min=q.get("cc_min"),
                    arch_vllm=bool(q.get("arch_vllm", True)),
                    arch_sglang=bool(q.get("arch_sglang", True)),
                    notes=q.get("notes"),
                )
            )

    print(f"[seed] inserted {len(catalog.get('models', []))} models")


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("DELETE FROM model_quants"))
    conn.execute(sa.text("DELETE FROM models"))
