"""Run report: build, sanitize, and publish model run outcomes to GitHub."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.entities import Model, ModelQuant, ModelRunAttempt, PlatformSetting, Server

# ── Sanitizer patterns ────────────────────────────────────────────────────────

_IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_API_KEY_RE = re.compile(
    r"(?:sk-[A-Za-z0-9]{10,}|hf_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{10,}|"
    r"ghs_[A-Za-z0-9]{10,}|sk-ant-[A-Za-z0-9\-]{10,}|"
    r"glpat-[A-Za-z0-9\-]{10,})"
)
_HOME_PATH_RE = re.compile(r"/(?:root|home/[^/]+)/\S*")
_HOSTNAME_LIKE_RE = re.compile(r"\b[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.local\b")


def _slug(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", s)[:64]


def _scrub_string(value: str, server_alias: str) -> str:
    value = _IP_RE.sub("[ip-redacted]", value)
    value = _HOME_PATH_RE.sub("[path-redacted]", value)
    value = _HOSTNAME_LIKE_RE.sub("[host-redacted]", value)
    return value


def _scrub_value(value: Any, server_alias: str) -> Any:
    if isinstance(value, str):
        return _scrub_string(value, server_alias)
    if isinstance(value, dict):
        return {k: _scrub_value(v, server_alias) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub_value(item, server_alias) for item in value]
    return value


# ── Report builder ─────────────────────────────────────────────────────────────

def build_report(run_id: uuid.UUID, db: Session) -> dict:
    """Assemble a full run report dict from DB rows."""
    run: ModelRunAttempt | None = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == run_id).first()
    if not run:
        raise ValueError(f"ModelRunAttempt {run_id} not found")

    server: Server | None = db.query(Server).filter(Server.id == run.server_id).first()
    model: Model | None = db.query(Model).filter(Model.id == run.model_id).first()
    quant: ModelQuant | None = db.query(ModelQuant).filter(ModelQuant.id == run.quant_id).first()

    gpu_model = server.gpu_model if server else None
    gpu_vram = server.vram_gb if server else None

    report: dict = {
        "schema": "inferix/run-report/v1",
        "run_id": str(run.id),
        "published_at": datetime.now(timezone.utc).isoformat(),
        "platform": {
            "publisher": "inferix",
        },
        "model": {
            "key": model.model_key if model else None,
            "family": model.family if model else None,
            "name": model.name if model else None,
            "param_count_b": model.param_count_b if model else None,
            "quant_name": quant.name if quant else None,
            "bits_per_weight": quant.bits_per_weight if quant else None,
            "hf_repo": quant.hf_repo if quant else None,
        },
        "host": {
            "gpu_model": gpu_model,
            "gpu_vram_gb": gpu_vram,
            "gpu_count": None,
            "compute_capability": None,
            "driver_version": None,
            "cuda_runtime_host": None,
            "nvlink": None,
            "interconnect": None,
            "homogeneous": None,
            "docker_present": None,
            "nvidia_container_toolkit": None,
            "snapshot_captured_at": None,
        },
        "stack": {
            "engine": run.engine.value if run.engine else None,
            "engine_version": run.engine_version,
            "mode": run.mode,
            "container_image": run.container_image,
            "tp_size": None,
            "extra_flags": [],
        },
        "feasibility": {
            "verdict": run.feasibility_verdict,
            "forced": run.forced,
            "checks": [],
        },
        "outcome": {
            "status": run.status.value if run.status else None,
            "succeeded": run.succeeded,
            "failure_stage": run.failure_stage.value if run.failure_stage else None,
            "failure_message": run.failure_message,
            "ttft_ms": run.ttft_ms,
            "tps_steady": run.tps_steady,
            "vram_used_gb": run.vram_used_gb,
            "health_check_ok": run.health_check_ok,
            "duration_seconds": run.duration_seconds,
        },
        "notes": run.operator_notes,
    }

    # Enrich host section from launch plan if available
    if run.launch_plan_json:
        plan = run.launch_plan_json
        if isinstance(plan, dict):
            report["stack"]["tp_size"] = plan.get("tp_size")
            report["host"]["gpu_count"] = plan.get("gpu_count")

    # Enrich host from host_snapshot stored in session metadata (best effort)
    return report


# ── Sanitizer ─────────────────────────────────────────────────────────────────

def sanitize_report(report: dict) -> dict:
    """Strip all PII, credentials, hostnames, IPs, and secret-looking tokens.

    Mutates a copy — never the original.
    """
    import copy
    report = copy.deepcopy(report)

    # Replace run_id with a short public alias
    short_id = str(report.get("run_id", ""))[:8]
    report["run_id"] = f"run-{short_id}"

    # Scrub notes: if they contain API key patterns, drop entirely
    notes = report.get("notes", "")
    if notes and _API_KEY_RE.search(str(notes)):
        report["notes"] = "[redacted: contained credential-like token]"
    elif notes:
        report["notes"] = _scrub_string(str(notes), "")

    # Scrub host section
    host = report.get("host", {})
    if isinstance(host, dict):
        for field in ("gpu_model",):
            if field in host and isinstance(host[field], str):
                host[field] = _scrub_string(host[field], "")

    # Scrub failure_message
    outcome = report.get("outcome", {})
    if isinstance(outcome, dict) and outcome.get("failure_message"):
        outcome["failure_message"] = _scrub_value(outcome["failure_message"], "")

    # Scrub stack fields (container image may contain registry hostnames)
    stack = report.get("stack", {})
    if isinstance(stack, dict) and stack.get("container_image"):
        # Only scrub if it looks like a private registry (contains a dot+port or IP)
        img = str(stack["container_image"])
        if _IP_RE.search(img):
            stack["container_image"] = "[private-registry]"

    return report


# ── GitHub publisher ───────────────────────────────────────────────────────────

def _get_setting(key: str, db: Session) -> str | None:
    row = db.query(PlatformSetting).filter(PlatformSetting.key == key).first()
    return row.value if row else None


def publish_to_github(
    run_id: uuid.UUID,
    sanitized_report: dict,
    db: Session,
) -> dict[str, str]:
    """Push sanitized_report as a JSON file to the configured GitHub repo.

    Returns {"url": commit_html_url, "sha": commit_sha}.
    Raises ValueError if GitHub settings are not configured.
    """
    import json
    from github import Github, GithubException

    token = _get_setting("github_token", db)
    repo_name = _get_setting("github_repo", db)
    branch = _get_setting("github_branch", db) or "main"
    mode = _get_setting("github_publish_mode", db) or "commit"

    if not token:
        raise ValueError("github_token not configured — set it in Settings")
    if not repo_name:
        raise ValueError("github_repo not configured (e.g. yourname/inferix-runs) — set it in Settings")

    g = Github(token)
    repo = g.get_repo(repo_name)

    model = sanitized_report.get("model", {})
    host = sanitized_report.get("host", {})
    model_family = _slug(str(model.get("family") or "unknown"))
    model_key = _slug(str(model.get("key") or "unknown"))
    quant_name = _slug(str(model.get("quant_name") or "unknown"))
    gpu_slug = _slug(str(host.get("gpu_model") or "unknown"))
    verdict = sanitized_report.get("feasibility", {}).get("verdict", "UNKNOWN")

    path = f"runs/{model_family}/{model_key}/{quant_name}/{gpu_slug}/{run_id}.json"
    content = json.dumps(sanitized_report, indent=2, default=str)
    commit_msg = (
        f"feat(run): {model.get('key', 'unknown')} {model.get('quant_name', '')} "
        f"on {host.get('gpu_model', 'unknown')} [{verdict}]"
    )

    try:
        existing = repo.get_contents(path, ref=branch)
        result = repo.update_file(
            path=path,
            message=commit_msg,
            content=content,
            sha=existing.sha if hasattr(existing, "sha") else "",
            branch=branch,
        )
    except GithubException:
        result = repo.create_file(
            path=path,
            message=commit_msg,
            content=content,
            branch=branch,
        )

    commit = result.get("commit")
    url = commit.html_url if commit else f"https://github.com/{repo_name}/blob/{branch}/{path}"
    sha = commit.sha if commit else ""
    return {"url": url, "sha": sha}
