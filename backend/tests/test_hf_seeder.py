"""Unit tests for the HF seeder modules — no DB required."""
import math
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.hf_constants import (
    KNOWN_COMMUNITY_AUTHORS,
    STANDARD_AUTHORS,
    classify_author,
)
from app.services.hf_seeder import _upsert_model_variant


# ── classify_author ───────────────────────────────────────────────────────────

def test_standard_author_meta():
    author, cls, label = classify_author("meta-llama/Llama-3.1-8B-Instruct")
    assert author == "meta-llama"
    assert cls == "standard"
    assert label == "Meta"


def test_standard_author_google():
    author, cls, label = classify_author("google/gemma-2-9b-it")
    assert author == "google"
    assert cls == "standard"
    assert label == "Google"


def test_standard_author_mistral():
    author, cls, label = classify_author("mistralai/Mistral-7B-Instruct-v0.3")
    assert author == "mistralai"
    assert cls == "standard"


def test_community_author_bartowski():
    author, cls, label = classify_author("bartowski/Llama-3.1-8B-GGUF")
    assert author == "bartowski"
    assert cls == "community"


def test_community_author_thebloke():
    author, cls, label = classify_author("TheBloke/Llama-2-7B-GGUF")
    assert cls == "community"


def test_private_author():
    author, cls, label = classify_author("some-random-user/my-custom-model")
    assert author == "some-random-user"
    assert cls == "private"
    assert label == "some-random-user"


def test_author_key_lookup_is_case_insensitive():
    # STANDARD_AUTHORS keys are lowercase; mixed-case org in repo_id should still match
    _, cls, _ = classify_author("Meta-Llama/Llama-3.1-8B")
    assert cls == "standard"


def test_no_slash_falls_back_to_private():
    author, cls, label = classify_author("bare-name")
    assert cls == "private"
    assert author == "bare-name"
    assert label == "bare-name"


def test_returns_three_tuple():
    result = classify_author("mistralai/Mistral-7B-Instruct-v0.3")
    assert len(result) == 3
    author, cls, label = result
    assert isinstance(author, str)
    assert isinstance(cls, str)
    assert isinstance(label, str)


def test_standard_author_url_not_in_result():
    # classify_author only returns (author, class, label) — URL is derived separately by the seeder
    _, _, label = classify_author("meta-llama/Llama-3.1-8B-Instruct")
    assert "http" not in label


# ── Vocabulary completeness ───────────────────────────────────────────────────

def test_all_standard_authors_have_non_empty_labels():
    for key, label in STANDARD_AUTHORS.items():
        assert label, f"STANDARD_AUTHORS[{key!r}] has an empty label"


def test_all_community_authors_have_non_empty_labels():
    for key, label in KNOWN_COMMUNITY_AUTHORS.items():
        assert label, f"KNOWN_COMMUNITY_AUTHORS[{key!r}] has an empty label"


def test_standard_and_community_keys_do_not_overlap():
    overlap = set(STANDARD_AUTHORS) & set(KNOWN_COMMUNITY_AUTHORS)
    assert not overlap, f"Keys in both dicts: {overlap}"


# ── _upsert_model_variant — field mapping ─────────────────────────────────────

def _make_model(
    model_key="meta-llama/Llama-3.1-8B-Instruct",
    max_context_k=128,
    num_attention_heads=32,
    tp_allowed_sizes=None,
) -> SimpleNamespace:
    return SimpleNamespace(
        model_key=model_key,
        max_context_k=max_context_k,
        num_attention_heads=num_attention_heads,
        tp_allowed_sizes=tp_allowed_sizes or [1, 2, 4, 8],
    )


def _make_quant(
    name="FP8",
    vram_weights_gb=10.5,
    cc_min="8.9",
    arch_vllm=True,
    arch_sglang=False,
    hf_repo="nm-testing/Llama-3.1-8B-FP8",
) -> SimpleNamespace:
    return SimpleNamespace(
        name=name,
        vram_weights_gb=vram_weights_gb,
        cc_min=cc_min,
        arch_vllm=arch_vllm,
        arch_sglang=arch_sglang,
        hf_repo=hf_repo,
    )


def _make_db(existing_variant=None):
    db = MagicMock()
    db.query.return_value.filter_by.return_value.first.return_value = existing_variant
    return db


def test_upsert_creates_variant_when_none_exists():
    db = _make_db(existing_variant=None)
    model = _make_model()
    mq = _make_quant(vram_weights_gb=10.5, cc_min="8.9")

    _upsert_model_variant(db, model, mq)

    db.add.assert_called_once()
    added = db.add.call_args[0][0]
    assert added.model_key == model.model_key
    assert added.quant == "FP8"
    assert added.vram_min_gb == math.ceil(10.5)  # 11
    assert added.cc_min == "8.9"
    assert added.arch_supported_vllm is True
    assert added.arch_supported_sglang is False
    assert added.num_attention_heads == 32
    assert added.tp_allowed_sizes == [1, 2, 4, 8]
    assert added.context_default == 128 * 1024
    assert added.hf_repo == "nm-testing/Llama-3.1-8B-FP8"


def test_upsert_updates_existing_variant():
    existing = MagicMock()
    db = _make_db(existing_variant=existing)
    model = _make_model()
    mq = _make_quant(vram_weights_gb=10.5)

    _upsert_model_variant(db, model, mq)

    db.add.assert_not_called()
    # setattr was called on the existing object
    assert existing.vram_min_gb == math.ceil(10.5)
    assert existing.model_key == model.model_key


def test_upsert_defaults_cc_min_when_none():
    db = _make_db(existing_variant=None)
    mq = _make_quant(cc_min=None)

    _upsert_model_variant(db, _make_model(), mq)

    added = db.add.call_args[0][0]
    assert added.cc_min == "7.5"


def test_upsert_defaults_vram_when_zero():
    db = _make_db(existing_variant=None)
    mq = _make_quant(vram_weights_gb=0.0)

    _upsert_model_variant(db, _make_model(), mq)

    added = db.add.call_args[0][0]
    assert added.vram_min_gb == 1


def test_upsert_defaults_context_when_max_context_k_zero():
    db = _make_db(existing_variant=None)
    model = _make_model(max_context_k=0)

    _upsert_model_variant(db, model, _make_quant())

    added = db.add.call_args[0][0]
    assert added.context_default == 8192


def test_upsert_truncates_quant_name_to_32_chars():
    db = _make_db(existing_variant=None)
    long_name = "Q" * 50
    mq = _make_quant(name=long_name)

    _upsert_model_variant(db, _make_model(), mq)

    added = db.add.call_args[0][0]
    assert len(added.quant) == 32
    assert added.quant == long_name[:32]


def test_upsert_vram_ceil_rounds_up():
    db = _make_db(existing_variant=None)
    mq = _make_quant(vram_weights_gb=7.1)

    _upsert_model_variant(db, _make_model(), mq)

    added = db.add.call_args[0][0]
    assert added.vram_min_gb == 8  # ceil(7.1)
