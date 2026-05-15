from app.schemas.deployment_plan import PipelineModelFlags
from app.services.lab_vllm import (
    build_vllm_serve_cmd,
    classify_vllm_failure,
    retry_profiles,
    sanitize_extra_flags,
)


def test_classifies_known_vllm_failures():
    text = """
    tmux: command not found
    RuntimeError: CUDA out of memory during memory profiling
    fatal error: Python.h: No such file or directory
    """

    ids = {match["issue_id"] for match in classify_vllm_failure(text)}

    assert {"tmux_missing", "cuda_oom", "python_headers_missing"}.issubset(ids)


def test_retry_profiles_dedupe_and_fallback_order():
    desired = PipelineModelFlags(
        max_model_len=8192,
        gpu_memory_utilization=0.9,
        enable_chunked_prefill=False,
        extra_flags="",
        remote_port=8000,
    )

    profiles = retry_profiles(desired)

    assert profiles[0].max_model_len == 8192
    assert profiles[0].gpu_memory_utilization == 0.9
    assert profiles[1].max_model_len == 8192
    assert profiles[1].gpu_memory_utilization == 0.85
    assert profiles[2].max_model_len == 4096
    assert profiles[2].gpu_memory_utilization == 0.75
    assert profiles[2].enable_chunked_prefill is True
    assert "--enforce-eager" in profiles[2].extra_flags
    assert profiles[3].max_model_len == 2048


def test_vllm_command_quotes_repo_and_extra_flags_tokens():
    flags = PipelineModelFlags(
        max_model_len=4096,
        gpu_memory_utilization=0.75,
        enable_chunked_prefill=True,
        extra_flags="--enforce-eager --served-model-name 'safe alias'",
    )

    command = build_vllm_serve_cmd("org/model name", flags)

    assert "vllm serve 'org/model name'" in command
    assert "--max-model-len 4096" in command
    assert "--enable-chunked-prefill" in command
    assert "--served-model-name 'safe alias'" in command
    assert sanitize_extra_flags("--flag 'two words'") == "--flag 'two words'"
