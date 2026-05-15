"""Tests for settings_service parsing helpers."""

from app.models.entities import PlatformSetting
from app.services.settings_service import (
    _VALID_QUANT_FORMATS,
    bootstrap_defaults_from_env,
    get_default_seed_models,
    get_excluded_quant_formats,
    get_setting,
    get_lab_auto_setup_mode,
    get_lab_default_runtime_mode,
    get_lab_preflight_command_overrides,
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


def test_bootstrap_defaults_from_env_seeds_once_and_clamps_bandwidth(db, monkeypatch):
    for key in (
        "_default_env_bootstrapped_at",
        "default_seed_models",
        "excluded_quant_formats",
        "clore_min_pcie_gen",
        "clore_min_dl_mbps",
        "clore_gpu_query",
    ):
        _clear(db, key)

    from app.workers import tasks

    queued: list[str] = []
    monkeypatch.setattr(tasks.seed_model_from_hf, "delay", lambda repo_id: queued.append(repo_id))
    monkeypatch.setenv("DEFAULT_SEED_MODELS", "org/model-a")
    monkeypatch.setenv("DEFAULT_EXCLUDED_QUANT_FORMATS", "gguf,not-real,mlx")
    monkeypatch.setenv("DEFAULT_GLOBAL_FILTERS", '{"pcie_gen":3,"download_mbps":9000,"gpu":"RTX 4090"}')

    result = bootstrap_defaults_from_env(db)

    assert result["bootstrapped"] is True
    assert get_setting("default_seed_models", db) == "org/model-a"
    assert get_setting("excluded_quant_formats", db) == "gguf,mlx"
    assert get_setting("clore_min_pcie_gen", db) == "3"
    assert get_setting("clore_min_dl_mbps", db) == "3000"
    assert get_setting("clore_gpu_query", db) == "RTX 4090"
    assert queued == ["org/model-a"]

    monkeypatch.setenv("DEFAULT_GLOBAL_FILTERS", '{"pcie_gen":5}')
    second = bootstrap_defaults_from_env(db)
    assert second["bootstrapped"] is False
    assert get_setting("clore_min_pcie_gen", db) == "3"


# ── Lab deployment settings ──────────────────────────────────────────────────

def test_lab_auto_setup_mode_defaults_to_recommend_only(db):
    _clear(db, "lab_auto_setup_mode")
    assert get_lab_auto_setup_mode(db) == "recommend_only"


def test_lab_auto_setup_mode_accepts_auto_low_risk(db):
    _put(db, "lab_auto_setup_mode", "auto_low_risk_setup")
    assert get_lab_auto_setup_mode(db) == "auto_low_risk_setup"


def test_lab_auto_setup_mode_rejects_unknown(db):
    _put(db, "lab_auto_setup_mode", "dangerous")
    assert get_lab_auto_setup_mode(db) == "recommend_only"


def test_lab_default_runtime_mode_defaults_to_auto(db):
    _clear(db, "lab_default_runtime_mode")
    assert get_lab_default_runtime_mode(db) == "auto"


def test_lab_default_runtime_mode_accepts_uv_venv(db):
    _put(db, "lab_default_runtime_mode", "uv_venv")
    assert get_lab_default_runtime_mode(db) == "uv_venv"


def test_lab_default_runtime_mode_rejects_unknown(db):
    _put(db, "lab_default_runtime_mode", "systemd")
    assert get_lab_default_runtime_mode(db) == "auto"


def test_lab_preflight_command_overrides_empty_when_not_set(db):
    _clear(db, "lab_preflight_command_overrides")
    assert get_lab_preflight_command_overrides(db) == {}


def test_lab_preflight_command_overrides_sanitizes_known_steps(db):
    _put(
        db,
        "lab_preflight_command_overrides",
        '{"apt_update":{"enabled":false},"create_venv":{"command":"echo {venv_id}","required":false}}',
    )
    result = get_lab_preflight_command_overrides(db)
    assert result == {
        "apt_update": {"enabled": False},
        "create_venv": {"required": False, "command": "echo {venv_id}"},
    }


def test_lab_preflight_command_overrides_ignores_unknown_steps(db):
    _put(db, "lab_preflight_command_overrides", '{"launch_vllm":{"command":"rm -rf /"}}')
    assert get_lab_preflight_command_overrides(db) == {}


def test_lab_preflight_command_overrides_ignores_invalid_json(db):
    _put(db, "lab_preflight_command_overrides", "not-json")
    assert get_lab_preflight_command_overrides(db) == {}
