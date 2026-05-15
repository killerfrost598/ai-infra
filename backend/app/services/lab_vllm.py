"""vLLM Lab command builders, retry profiles, and known-issue matching."""

from __future__ import annotations

import re
import shlex
from dataclasses import dataclass
from typing import Any

from app.schemas.deployment_plan import PipelineModelFlags


@dataclass(frozen=True)
class KnownIssue:
    issue_id: str
    title: str
    patterns: tuple[re.Pattern[str], ...]
    diagnosis: str
    recommended_fix: str
    remediation: str | None
    safe_to_auto_apply: bool


KNOWN_ISSUES: tuple[KnownIssue, ...] = (
    KnownIssue(
        issue_id="tmux_missing",
        title="tmux is not installed",
        patterns=(re.compile(r"tmux:\s*command not found", re.I), re.compile(r"command not found:\s*tmux", re.I)),
        diagnosis="The launch wrapper uses tmux, but tmux is missing on the host.",
        recommended_fix="Install tmux, then restart the managed vLLM session.",
        remediation="install_tmux",
        safe_to_auto_apply=True,
    ),
    KnownIssue(
        issue_id="c_compiler_missing",
        title="C compiler is missing",
        patterns=(re.compile(r"failed to find c compiler", re.I), re.compile(r"no acceptable c compiler found", re.I)),
        diagnosis="A package build needs a C compiler and the host does not have one available.",
        recommended_fix="Install build-essential and export CC to gcc or cc before installing/launching.",
        remediation="install_build_deps",
        safe_to_auto_apply=True,
    ),
    KnownIssue(
        issue_id="python_headers_missing",
        title="Python headers are missing",
        patterns=(re.compile(r"Python\.h:\s*No such file", re.I), re.compile(r"fatal error:\s*Python\.h", re.I)),
        diagnosis="A Python extension build needs the Python development headers.",
        recommended_fix="Install python3.12-dev, then retry the install or launch.",
        remediation="install_build_deps",
        safe_to_auto_apply=True,
    ),
    KnownIssue(
        issue_id="cuda_oom",
        title="CUDA memory pressure during vLLM startup",
        patterns=(
            re.compile(r"CUDA out of memory", re.I),
            re.compile(r"OutOfMemoryError", re.I),
            re.compile(r"No available memory for the cache blocks", re.I),
            re.compile(r"KV cache", re.I),
            re.compile(r"memory profiling", re.I),
            re.compile(r"max seq len.*KV cache", re.I),
        ),
        diagnosis="vLLM could not reserve enough GPU memory for weights, graph capture, and KV cache.",
        recommended_fix="Retry with a smaller max_model_len, lower GPU memory utilization, chunked prefill, and eager mode.",
        remediation="lower_memory_profile",
        safe_to_auto_apply=True,
    ),
    KnownIssue(
        issue_id="hf_access",
        title="Hugging Face access failed",
        patterns=(
            re.compile(r"gated repo", re.I),
            re.compile(r"Cannot access gated", re.I),
            re.compile(r"401 Client Error", re.I),
            re.compile(r"403 Client Error", re.I),
            re.compile(r"Repository Not Found", re.I),
            re.compile(r"rate limit|too many requests", re.I),
            re.compile(r"HfHubHTTPError", re.I),
        ),
        diagnosis="The model download or load failed because Hugging Face access was denied, gated, missing, or rate limited.",
        recommended_fix="Check the configured HF token and confirm the account has accepted gated model access.",
        remediation="check_hf_token",
        safe_to_auto_apply=False,
    ),
    KnownIssue(
        issue_id="port_in_use",
        title="vLLM port is already in use",
        patterns=(re.compile(r"address already in use", re.I), re.compile(r"port\s+\d+\s+.*in use", re.I)),
        diagnosis="Another process is already bound to the requested vLLM port.",
        recommended_fix="Stop the old managed tmux session or choose a new port.",
        remediation="restart_managed_session",
        safe_to_auto_apply=True,
    ),
    KnownIssue(
        issue_id="missing_vllm",
        title="vLLM environment is missing",
        patterns=(
            re.compile(r"vllm-2/bin/vllm:?\s*No such file", re.I),
            re.compile(r"No module named ['\"]?vllm", re.I),
            re.compile(r"vllm:\s*command not found", re.I),
        ),
        diagnosis="The managed Python environment is missing vLLM or the vLLM executable.",
        recommended_fix="Rerun the vLLM install step before launching the model.",
        remediation="install_vllm",
        safe_to_auto_apply=True,
    ),
    KnownIssue(
        issue_id="health_timeout",
        title="vLLM did not become healthy",
        patterns=(re.compile(r"did not become healthy within", re.I), re.compile(r"Health check did not pass", re.I)),
        diagnosis="The server process did not answer /v1/models before the health deadline.",
        recommended_fix="Inspect /tmp/vllm.log and retry with the next safer launch profile if no access error is present.",
        remediation="lower_memory_profile",
        safe_to_auto_apply=True,
    ),
)


def _evidence(text: str, pattern: re.Pattern[str]) -> str:
    for line in text.splitlines():
        if pattern.search(line):
            return line.strip()[:300]
    match = pattern.search(text)
    return match.group(0)[:300] if match else ""


def classify_vllm_failure(text: str) -> list[dict[str, Any]]:
    """Return deterministic known-issue matches for vLLM/task log text."""
    if not text:
        return []
    matches: list[dict[str, Any]] = []
    for issue in KNOWN_ISSUES:
        evidence = ""
        for pattern in issue.patterns:
            if pattern.search(text):
                evidence = _evidence(text, pattern)
                break
        if evidence:
            matches.append(
                {
                    "issue_id": issue.issue_id,
                    "title": issue.title,
                    "diagnosis": issue.diagnosis,
                    "recommended_fix": issue.recommended_fix,
                    "remediation": issue.remediation,
                    "safe_to_auto_apply": issue.safe_to_auto_apply,
                    "evidence": evidence,
                }
            )
    return matches


def primary_failure_kind(matches: list[dict[str, Any]]) -> str | None:
    return matches[0]["issue_id"] if matches else None


def sanitize_extra_flags(extra_flags: str) -> str:
    """Quote user-supplied extra vLLM flags as argv tokens instead of raw shell."""
    raw = (extra_flags or "").strip()
    if not raw:
        return ""
    return " ".join(shlex.quote(token) for token in shlex.split(raw))


def _extra_tokens(extra_flags: str) -> list[str]:
    try:
        return shlex.split(extra_flags or "")
    except ValueError:
        return []


def has_enforce_eager(flags: PipelineModelFlags) -> bool:
    return "--enforce-eager" in _extra_tokens(flags.extra_flags)


def with_enforce_eager(extra_flags: str, enabled: bool) -> str:
    tokens = [token for token in _extra_tokens(extra_flags) if token != "--enforce-eager"]
    if enabled:
        tokens.append("--enforce-eager")
    return " ".join(tokens)


def build_vllm_serve_cmd(hf_repo: str, flags: PipelineModelFlags) -> str:
    venv = "~/.inferix/venvs/vllm-2"
    parts = [
        f"{venv}/bin/vllm serve {shlex.quote(hf_repo)}",
        f"--port {int(flags.remote_port)}",
        f"--gpu-memory-utilization {float(flags.gpu_memory_utilization)}",
        f"--dtype {shlex.quote(flags.dtype)}",
    ]
    if flags.tensor_parallel_size > 1:
        parts.append(f"--tensor-parallel-size {int(flags.tensor_parallel_size)}")
    if flags.max_model_len:
        parts.append(f"--max-model-len {int(flags.max_model_len)}")
    if flags.enable_tools:
        parts.append("--enable-auto-tool-choice")
        if flags.tool_call_parser:
            parts.append(f"--tool-call-parser {shlex.quote(flags.tool_call_parser)}")
    if flags.enable_thinking and flags.reasoning_parser:
        parts.append(f"--reasoning-parser {shlex.quote(flags.reasoning_parser)}")
    if flags.enable_chunked_prefill:
        parts.append("--enable-chunked-prefill")
    if flags.trust_remote_code:
        parts.append("--trust-remote-code")
    sanitized_extra = sanitize_extra_flags(flags.extra_flags)
    if sanitized_extra:
        parts.append(sanitized_extra)
    return " ".join(parts)


def profile_to_dict(flags: PipelineModelFlags, *, name: str | None = None) -> dict[str, Any]:
    return {
        "name": name,
        "max_model_len": flags.max_model_len,
        "gpu_memory_utilization": flags.gpu_memory_utilization,
        "enable_chunked_prefill": flags.enable_chunked_prefill,
        "enforce_eager": has_enforce_eager(flags),
        "dtype": flags.dtype,
        "tensor_parallel_size": flags.tensor_parallel_size,
        "remote_port": flags.remote_port,
        "extra_flags": flags.extra_flags,
    }


def _same_profile(left: PipelineModelFlags, right: PipelineModelFlags) -> bool:
    return (
        left.max_model_len == right.max_model_len
        and round(float(left.gpu_memory_utilization), 4) == round(float(right.gpu_memory_utilization), 4)
        and bool(left.enable_chunked_prefill) == bool(right.enable_chunked_prefill)
        and has_enforce_eager(left) == has_enforce_eager(right)
        and int(left.remote_port) == int(right.remote_port)
    )


def _fallback(base: PipelineModelFlags, *, max_model_len: int, gpu_memory_utilization: float, chunked: bool, eager: bool) -> PipelineModelFlags:
    return base.model_copy(
        update={
            "max_model_len": max_model_len,
            "gpu_memory_utilization": gpu_memory_utilization,
            "enable_chunked_prefill": chunked,
            "extra_flags": with_enforce_eager(base.extra_flags, eager),
        }
    )


def retry_profiles(desired: PipelineModelFlags) -> list[PipelineModelFlags]:
    """Desired profile followed by deterministic safe fallbacks."""
    candidates = [
        desired,
        _fallback(desired, max_model_len=8192, gpu_memory_utilization=0.85, chunked=False, eager=False),
        _fallback(desired, max_model_len=4096, gpu_memory_utilization=0.75, chunked=True, eager=True),
        _fallback(desired, max_model_len=2048, gpu_memory_utilization=0.70, chunked=True, eager=True),
    ]
    result: list[PipelineModelFlags] = []
    for candidate in candidates:
        if not any(_same_profile(candidate, existing) for existing in result):
            result.append(candidate)
    return result


def parse_vllm_help_flags(help_text: str) -> dict[str, Any]:
    flags = sorted(set(re.findall(r"(?<!\w)(--[a-zA-Z0-9][a-zA-Z0-9_-]*)", help_text or "")))
    return {
        "flags": flags,
        "supports_cpu_offload_gb": "--cpu-offload-gb" in flags,
        "supports_kv_cache_dtype": "--kv-cache-dtype" in flags,
        "supports_max_num_seqs": "--max-num-seqs" in flags,
        "supports_enable_chunked_prefill": "--enable-chunked-prefill" in flags,
        "supports_enforce_eager": "--enforce-eager" in flags,
    }


LAB_VLLM_HELP_NOTE = (
    "CPU RAM offload can reduce GPU pressure from model weights when --cpu-offload-gb is supported, "
    "but it is slower and does not make GPU KV cache free. For larger context, prefer lowering "
    "max_model_len/concurrency, using --kv-cache-dtype fp8 when supported, enabling chunked prefill, "
    "and using eager mode when CUDA graph overhead causes startup OOM."
)


def install_apt_packages_cmd(packages: str) -> str:
    return (
        "if ! command -v apt-get >/dev/null 2>&1; then\n"
        "  echo 'apt-get is required to install missing packages on this host' >&2\n"
        "  exit 127\n"
        "fi\n"
        "if command -v sudo >/dev/null 2>&1; then\n"
        f"  (sudo -n apt-get update -y && sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y {packages}) || "
        f"(apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y {packages})\n"
        "else\n"
        f"  apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y {packages}\n"
        "fi"
    )


def ensure_tmux_cmd() -> str:
    return (
        "if ! command -v tmux >/dev/null 2>&1; then\n"
        "  echo '[+] tmux not found; installing tmux...'\n"
        f"{install_apt_packages_cmd('tmux')}\n"
        "else\n"
        "  echo \"[+] tmux already installed: $(tmux -V)\"\n"
        "fi\n"
        "command -v tmux >/dev/null 2>&1"
    )


def ensure_c_compiler_cmd() -> str:
    return (
        "if ! command -v gcc >/dev/null 2>&1 || ! test -f /usr/include/python3.12/Python.h; then\n"
        "  echo '[+] C build dependencies missing; installing build-essential and python3.12-dev...'\n"
        f"{install_apt_packages_cmd('build-essential python3.12-dev')}\n"
        "else\n"
        "  echo \"[+] C build dependencies already installed: $(command -v gcc || command -v cc), /usr/include/python3.12/Python.h\"\n"
        "fi\n"
        "(command -v gcc >/dev/null 2>&1 || command -v cc >/dev/null 2>&1) && "
        "test -f /usr/include/python3.12/Python.h"
    )


def build_tmux_launch_cmd(vllm_cmd: str) -> str:
    inner = (
        "export PATH=$HOME/.local/bin:$PATH; "
        "export HF_TOKEN=$INFERIX_HF_TOKEN; "
        "export CC=${CC:-$(command -v gcc || command -v cc)}; "
        "export PYTORCH_CUDA_ALLOC_CONF=${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}; "
        f"{vllm_cmd} 2>&1 | tee /tmp/vllm.log"
    )
    return f"tmux new-session -d -s inferix-vllm -- bash -lc {shlex.quote(inner)}"


def wait_for_vllm_ready_cmd(remote_port: int, timeout_seconds: int = 420) -> str:
    health_url = f"http://127.0.0.1:{int(remote_port)}/v1/models"
    return (
        f"deadline=$((SECONDS + {int(timeout_seconds)}))\n"
        f"echo '[+] Waiting for vLLM health at {health_url}...'\n"
        "while [ \"$SECONDS\" -lt \"$deadline\" ]; do\n"
        f"  if curl -sf --max-time 5 {shlex.quote(health_url)} >/tmp/inferix-vllm-health.json 2>/dev/null; then\n"
        "    echo '[+] vLLM is healthy'\n"
        "    cat /tmp/inferix-vllm-health.json\n"
        "    exit 0\n"
        "  fi\n"
        "  if ! tmux has-session -t inferix-vllm 2>/dev/null; then\n"
        "    echo '[!] vLLM tmux session exited before readiness' >&2\n"
        "    tail -120 /tmp/vllm.log >&2 2>/dev/null || true\n"
        "    exit 1\n"
        "  fi\n"
        "  if grep -E 'ERROR|Traceback|RuntimeError|OutOfMemory|CUDA out of memory|Failed to find C compiler|Python.h: No such file|KV cache|Address already in use' /tmp/vllm.log >/tmp/inferix-vllm-errors 2>/dev/null; then\n"
        "    echo '[!] vLLM reported startup errors' >&2\n"
        "    tail -120 /tmp/vllm.log >&2 2>/dev/null || true\n"
        "    exit 1\n"
        "  fi\n"
        "  sleep 5\n"
        "done\n"
        f"echo '[!] vLLM did not become healthy within {int(timeout_seconds)}s' >&2\n"
        "tail -120 /tmp/vllm.log >&2 2>/dev/null || true\n"
        "exit 1"
    )
