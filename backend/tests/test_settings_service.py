"""Tests for settings_service parsing helpers."""

from app.models.entities import PlatformSetting
from app.services.settings_service import (
    _VALID_QUANT_FORMATS,
    get_default_seed_models,
    get_excluded_quant_formats,
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _put(db, key: str, value: str) -> None:
    """Insert (or replace) a PlatformSetting row within the test transaction."""
    db.query(PlatformSetting).filter_by(key=key).delete()
    db.add(PlatformSetting(key=key, value=value))
    db.flush()


def _clear(db, key: str) -> None:
    db.query(PlatformSetting).filter_by(key=key).delete()
    db.flush()


# ── get_excluded_quant_formats ────────────────────────────────────────────────

def test_excluded_formats_empty_when_not_set(db):
    _clear(db, "excluded_quant_formats")
    assert get_excluded_quant_formats(db) == set()


def test_excluded_formats_single_value(db):
    _put(db, "excluded_quant_formats", "mlx")
    assert get_excluded_quant_formats(db) == {"mlx"}


def test_excluded_formats_comma_separated(db):
    _put(db, "excluded_quant_formats", "mlx,gguf,fp4")
    assert get_excluded_quant_formats(db) == {"mlx", "gguf", "fp4"}


def test_excluded_formats_newline_separated(db):
    _put(db, "excluded_quant_formats", "mlx\ngguf")
    assert get_excluded_quant_formats(db) == {"mlx", "gguf"}


def test_excluded_formats_mixed_separators(db):
    _put(db, "excluded_quant_formats", "mlx, gguf\nfp8")
    result = get_excluded_quant_formats(db)
    assert result == {"mlx", "gguf", "fp8"}


def test_excluded_formats_strips_whitespace(db):
    _put(db, "excluded_quant_formats", "  mlx  ,  gguf  ")
    result = get_excluded_quant_formats(db)
    assert result == {"mlx", "gguf"}


def test_excluded_formats_case_insensitive(db):
    _put(db, "excluded_quant_formats", "MLX,GGUF,FP8")
    result = get_excluded_quant_formats(db)
    assert result == {"mlx", "gguf", "fp8"}


def test_excluded_formats_ignores_unknown_tokens(db):
    _put(db, "excluded_quant_formats", "mlx,not-a-format,gguf")
    result = get_excluded_quant_formats(db)
    assert "not-a-format" not in result
    assert "mlx" in result and "gguf" in result


def test_excluded_formats_all_valid_formats_accepted(db):
    _put(db, "excluded_quant_formats", ",".join(_VALID_QUANT_FORMATS))
    result = get_excluded_quant_formats(db)
    assert result == _VALID_QUANT_FORMATS


def test_excluded_formats_whitespace_only_is_empty(db):
    _put(db, "excluded_quant_formats", "   \n  ")
    # All tokens become empty strings → none pass the format check
    result = get_excluded_quant_formats(db)
    assert result == set()


# ── get_default_seed_models ───────────────────────────────────────────────────

def test_default_seed_models_empty_when_not_set(db):
    _clear(db, "default_seed_models")
    assert get_default_seed_models(db) == []


def test_default_seed_models_newline_separated(db):
    _put(db, "default_seed_models", "meta-llama/Llama-3.1-8B\nmistralai/Mistral-7B")
    result = get_default_seed_models(db)
    assert result == ["meta-llama/Llama-3.1-8B", "mistralai/Mistral-7B"]


def test_default_seed_models_comma_separated(db):
    _put(db, "default_seed_models", "meta-llama/Llama-3.1-8B,mistralai/Mistral-7B")
    result = get_default_seed_models(db)
    assert result == ["meta-llama/Llama-3.1-8B", "mistralai/Mistral-7B"]


def test_default_seed_models_ignores_lines_without_slash(db):
    _put(db, "default_seed_models", "meta-llama/Llama-3.1-8B\nnot-a-repo\n  \n")
    result = get_default_seed_models(db)
    assert "not-a-repo" not in result
    assert "meta-llama/Llama-3.1-8B" in result
    assert len(result) == 1


def test_default_seed_models_strips_whitespace(db):
    _put(db, "default_seed_models", "  meta-llama/Llama-3.1-8B  \n  mistralai/Mistral-7B  ")
    result = get_default_seed_models(db)
    assert "meta-llama/Llama-3.1-8B" in result
    assert "mistralai/Mistral-7B" in result


def test_default_seed_models_preserves_order(db):
    repos = ["a/b", "c/d", "e/f"]
    _put(db, "default_seed_models", "\n".join(repos))
    result = get_default_seed_models(db)
    assert result == repos
