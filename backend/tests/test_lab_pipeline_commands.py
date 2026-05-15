from app.api.v1.endpoints.lab import (
    _build_tmux_launch_cmd,
    _ensure_c_compiler_cmd,
    _ensure_pipeline_base_packages_cmd,
    _ensure_tmux_cmd,
    _wait_for_vllm_ready_cmd,
)


def test_pipeline_base_packages_install_tmux_and_curl():
    command = _ensure_pipeline_base_packages_cmd()

    assert "command -v curl" in command
    assert "command -v tmux" in command
    assert "build-essential" in command
    assert "python3.12-dev" in command
    assert "ca-certificates $missing" in command


def test_run_model_self_heals_missing_c_compiler():
    command = _ensure_c_compiler_cmd()

    assert "C build dependencies missing" in command
    assert "apt-get install -y build-essential python3.12-dev" in command
    assert "test -f /usr/include/python3.12/Python.h" in command


def test_run_model_self_heals_missing_tmux():
    command = _ensure_tmux_cmd()

    assert "tmux not found" in command
    assert "apt-get install -y tmux" in command
    assert command.endswith("command -v tmux >/dev/null 2>&1")


def test_tmux_launch_uses_bash_lc_and_log_tee():
    command = _build_tmux_launch_cmd("~/.inferix/venvs/vllm-2/bin/vllm serve org/model --port 8000")

    assert command.startswith("tmux new-session -d -s inferix-vllm -- bash -lc ")
    assert "HF_TOKEN=$INFERIX_HF_TOKEN" in command
    assert "CC=${CC:-$(command -v gcc || command -v cc)}" in command
    assert "PYTORCH_CUDA_ALLOC_CONF=${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}" in command
    assert "tee /tmp/vllm.log" in command


def test_wait_for_vllm_ready_checks_health_and_startup_errors():
    command = _wait_for_vllm_ready_cmd(8000, timeout_seconds=30)

    assert "curl -sf --max-time 5 http://127.0.0.1:8000/v1/models" in command
    assert "tmux has-session -t inferix-vllm" in command
    assert "CUDA out of memory" in command
    assert "tail -120 /tmp/vllm.log" in command
    assert "within 30s" in command
