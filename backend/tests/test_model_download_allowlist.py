"""Tests for model_download allowlist resolver."""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass

import pytest

from app.services.model_download.allowlist import (
    FileAllow,
    _ALWAYS_EXACT,
    resolve_allowlist,
)


@dataclass
class FakeQuant:
    hf_repo: str = ""
    quant_format: str = "gguf"
    notes: str = ""
    quant_variant: str = ""


@dataclass
class FakeModel:
    hf_repo: str = ""


# ── GGUF single file ──────────────────────────────────────────────────────────


def test_gguf_single_file_in_exact():
    """Single-file GGUF: filename in exact_files, no shard pattern."""
    quant = FakeQuant(
        hf_repo="unsloth/gemma-4-E2B-it-GGUF",
        quant_format="gguf",
        notes="gemma-4-E2B-it-Q4_K_M.gguf",
    )
    result = resolve_allowlist(quant, FakeModel())

    assert "gemma-4-E2B-it-Q4_K_M.gguf" in result.exact_files
    # No shard pattern
    shard_patterns = [p for p in result.allow_patterns if "-of-" in p]
    assert shard_patterns == []


def test_gguf_single_file_no_gguf_glob():
    """Single-file GGUF should NOT add a *.gguf catch-all pattern."""
    quant = FakeQuant(
        hf_repo="unsloth/gemma-4-E2B-it-GGUF",
        quant_format="gguf",
        notes="gemma-4-E2B-it-Q4_K_M.gguf",
    )
    result = resolve_allowlist(quant, FakeModel())
    # The *.gguf glob (fallback) should NOT be present
    assert "*.gguf" not in result.allow_patterns


# ── GGUF sharded ─────────────────────────────────────────────────────────────


def test_gguf_sharded_pattern():
    """Sharded GGUF: shard glob in allow_patterns, first file in exact_files."""
    quant = FakeQuant(
        hf_repo="unsloth/gemma-4-E2B-it-GGUF",
        quant_format="gguf",
        notes="3 shards · first: model-Q5_K_M-00001-of-00003.gguf",
    )
    result = resolve_allowlist(quant, FakeModel())

    assert "model-Q5_K_M-00001-of-00003.gguf" in result.exact_files
    assert "model-Q5_K_M-*-of-*.gguf" in result.allow_patterns


def test_gguf_sharded_pattern_matches_all_shards():
    """The generated shard pattern should match all shard files."""
    quant = FakeQuant(
        hf_repo="unsloth/gemma-4-E2B-it-GGUF",
        quant_format="gguf",
        notes="3 shards · first: model-Q5_K_M-00001-of-00003.gguf",
    )
    result = resolve_allowlist(quant, FakeModel())
    pattern = next(p for p in result.allow_patterns if "-of-" in p)

    candidates = [
        "model-Q5_K_M-00001-of-00003.gguf",
        "model-Q5_K_M-00002-of-00003.gguf",
        "model-Q5_K_M-00003-of-00003.gguf",
    ]
    for c in candidates:
        assert fnmatch.fnmatch(c, pattern), f"{c!r} should match {pattern!r}"


# ── Multi-variant exclusion ───────────────────────────────────────────────────


def test_gguf_multi_variant_filter_excludes_others():
    """Q4_K_M notes must NOT match Q2_K file via the resolver logic."""
    quant = FakeQuant(
        hf_repo="unsloth/gemma-4-E2B-it-GGUF",
        quant_format="gguf",
        notes="model-Q4_K_M.gguf",
    )
    result = resolve_allowlist(quant, FakeModel())

    # Simulate the helper's filter over a repo with both variants
    siblings = ["model-Q2_K.gguf", "model-Q4_K_M.gguf"]

    def matches(name: str) -> bool:
        if name in result.exact_files:
            return True
        return any(fnmatch.fnmatch(name, p) for p in result.allow_patterns)

    assert not matches("model-Q2_K.gguf"), "Q2_K should be excluded"
    assert matches("model-Q4_K_M.gguf"), "Q4_K_M should be included"


# ── Safetensors formats ───────────────────────────────────────────────────────


def test_awq_safetensors_patterns():
    """AWQ format must include *.safetensors and *.safetensors.index.json patterns."""
    quant = FakeQuant(
        hf_repo="org/model-awq",
        quant_format="awq",
    )
    result = resolve_allowlist(quant, FakeModel())

    assert "*.safetensors" in result.allow_patterns
    assert "*.safetensors.index.json" in result.allow_patterns


def test_fp16_safetensors_patterns():
    quant = FakeQuant(hf_repo="org/model-fp16", quant_format="fp16")
    result = resolve_allowlist(quant, FakeModel())
    assert "*.safetensors" in result.allow_patterns


# ── Tokenizer / config always included ───────────────────────────────────────


def test_always_exact_files_included():
    """All sidecar config/tokenizer files must always be in exact_files."""
    quant = FakeQuant(hf_repo="org/model", quant_format="fp16")
    result = resolve_allowlist(quant, FakeModel())

    for f in _ALWAYS_EXACT:
        assert f in result.exact_files, f"{f!r} missing from exact_files"


# ── files_key stability ───────────────────────────────────────────────────────


def test_files_key_stable():
    """Same inputs must always produce the same files_key."""
    quant = FakeQuant(hf_repo="org/model", quant_format="awq")
    r1 = resolve_allowlist(quant, FakeModel())
    r2 = resolve_allowlist(quant, FakeModel())
    assert r1.files_key == r2.files_key


def test_files_key_different_for_different_quants():
    """Different notes must produce different files_key."""
    q1 = FakeQuant(hf_repo="org/model", quant_format="gguf", notes="model-Q4_K_M.gguf")
    q2 = FakeQuant(hf_repo="org/model", quant_format="gguf", notes="model-Q2_K.gguf")
    r1 = resolve_allowlist(q1, FakeModel())
    r2 = resolve_allowlist(q2, FakeModel())
    assert r1.files_key != r2.files_key


# ── repo_id fallback ──────────────────────────────────────────────────────────


def test_repo_id_falls_back_to_model():
    """If quant.hf_repo is empty, use model.hf_repo."""
    quant = FakeQuant(hf_repo="", quant_format="awq")
    model = FakeModel(hf_repo="org/fallback-model")
    result = resolve_allowlist(quant, model)
    assert result.repo_id == "org/fallback-model"


def test_empty_repo_id_raises():
    """Empty hf_repo on both quant and model must raise ValueError."""
    quant = FakeQuant(hf_repo="", quant_format="awq")
    model = FakeModel(hf_repo="")
    with pytest.raises(ValueError, match="No Hugging Face repo_id"):
        resolve_allowlist(quant, model)
