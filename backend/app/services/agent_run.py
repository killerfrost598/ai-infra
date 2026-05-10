"""Guarded Lab agent-run executor.

The v1 agent is intentionally internal and MCP-inspired: resources, typed
tools, prompt-like event summaries, and a tool loop are represented in
TaskRun.metadata_json without exposing arbitrary shell access.
"""

from __future__ import annotations

import json
import logging
import re
import shlex
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import UUID

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.entities import (
    EngineKind,
    FailureStage,
    Model,
    ModelQuant,
    ModelRunAttempt,
    Playbook,
    PlaybookRunOutcome,
    RunStatus,
    Server,
    TaskRun,
    TaskStatus,
)
from app.models.entities import Session as SessionModel
from app.schemas.agent_runs import AgentRunEvent, AgentRunStatusResponse, PromotePlaybookResponse
from app.schemas.deployment_plan import DeploymentPlanStep
from app.services import session_store
from app.services.deployments.planner import build_deployment_plan
from app.services.lab_recommender import recommend_launch
from app.services.playbook_writer import write_playbook_to_local_repo
from app.services.session_runner import capture_host_snapshot
from app.services.settings_service import get_setting
from app.workers.utils import _finish_task_run, _log_path, _make_logger, _utcnow

logger = logging.getLogger(__name__)


_SECRET_PATTERNS = (
    re.compile(r"hf_[A-Za-z0-9_=-]{12,}"),
    re.compile(r"sk-[A-Za-z0-9_-]{12,}"),
    re.compile(r"sk-ant-[A-Za-z0-9_-]{12,}"),
    re.compile(r"ghp_[A-Za-z0-9_]{12,}"),
)

_SHELL_CONTROL_RE = re.compile(r"(&&|\|\||;|`|\$\(|<|>)")
_DESTRUCTIVE_RE = re.compile(
    r"(?<![-\w])("
    r"rm|rmdir|mkfs|dd|shutdown|reboot|halt|poweroff|iptables|ufw|"
    r"chown|chmod|userdel|groupdel|docker\s+rm|docker\s+system\s+prune"
    r")(?![\w])",
    re.IGNORECASE,
)

_OFFICIAL_CITATIONS = [
    {
        "title": "vLLM OpenAI-Compatible Server",
        "url": "https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html",
        "source": "official",
    },
    {
        "title": "vLLM Engine Arguments",
        "url": "https://docs.vllm.ai/en/latest/configuration/engine_args.html",
        "source": "official",
    },
    {
        "title": "tmux Manual",
        "url": "https://man7.org/linux/man-pages/man1/tmux.1.html",
        "source": "official",
    },
    {
        "title": "OpenAI Chat Completions API",
        "url": "https://platform.openai.com/docs/api-reference/chat/create",
        "source": "official",
    },
]


@dataclass(frozen=True)
class CommandPolicyResult:
    allowed: bool
    reason: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _tail(text: str, limit: int = 6000) -> str:
    if len(text) <= limit:
        return text
    return text[-limit:]


def _mask(text: str, known_secrets: list[str] | None = None) -> str:
    masked = text
    for secret in known_secrets or []:
        if secret:
            masked = masked.replace(secret, "[redacted]")
    for pattern in _SECRET_PATTERNS:
        masked = pattern.sub("[redacted]", masked)
    return masked


def model_tmux_session_name(model_run_id: str | UUID) -> str:
    raw = str(model_run_id).lower()
    safe = re.sub(r"[^a-z0-9_-]", "-", raw)
    return f"inferix-model-{safe}"[:90]


def validate_safe_shell_command(command: str) -> CommandPolicyResult:
    """Allow only low-risk probe/localhost commands for run_safe_shell."""
    stripped = command.strip()
    if not stripped:
        return CommandPolicyResult(False, "empty command")
    if "\n" in stripped:
        return CommandPolicyResult(False, "multi-line shell is not allowed")
    if _SHELL_CONTROL_RE.search(stripped):
        return CommandPolicyResult(False, "shell control operators are not allowed")
    if _DESTRUCTIVE_RE.search(stripped):
        return CommandPolicyResult(False, "destructive commands are blocked")

    try:
        parts = shlex.split(stripped)
    except ValueError as exc:
        return CommandPolicyResult(False, f"invalid shell syntax: {exc}")
    if not parts:
        return CommandPolicyResult(False, "empty command")

    executable = parts[0]
    if executable in {"nvidia-smi", "uname", "df", "free"}:
        return CommandPolicyResult(True, "allowed host probe")
    if executable in {"python", "python3"} and all(p in {"--version", "-V"} for p in parts[1:]):
        return CommandPolicyResult(True, "allowed Python version probe")
    if executable == "docker" and len(parts) >= 2 and parts[1] in {"--version", "version", "info", "ps", "images"}:
        return CommandPolicyResult(True, "allowed Docker probe")
    if executable == "tmux" and len(parts) >= 2 and parts[1] in {"has-session", "list-sessions", "capture-pane", "display-message"}:
        return CommandPolicyResult(True, "allowed tmux inspection")
    if executable in {"which", "command"}:
        return CommandPolicyResult(True, "allowed executable lookup")
    if executable == "cat" and len(parts) == 2 and parts[1] in {"/etc/os-release", "/proc/meminfo"}:
        return CommandPolicyResult(True, "allowed system file read")
    if executable == "curl":
        urls = [p for p in parts[1:] if p.startswith("http://") or p.startswith("https://")]
        if urls and all(u.startswith("http://127.0.0.1:") or u.startswith("http://localhost:") for u in urls):
            return CommandPolicyResult(True, "allowed localhost HTTP probe")
        return CommandPolicyResult(False, "curl is limited to localhost health probes")

    return CommandPolicyResult(False, f"command '{executable}' is not allowlisted")


def validate_launch_command(command: str) -> CommandPolicyResult:
    """Allow only vLLM launch commands generated from platform context."""
    stripped = command.strip()
    if not stripped:
        return CommandPolicyResult(False, "empty launch command")
    if "\n" in stripped:
        return CommandPolicyResult(False, "multi-line launch command is not allowed")
    if any(token in stripped for token in ("&&", "||", ";", "`", "$(")):
        return CommandPolicyResult(False, "shell control operators are not allowed in launch commands")
    if _DESTRUCTIVE_RE.search(stripped):
        return CommandPolicyResult(False, "destructive launch command is blocked")
    if "docker run" in stripped and "vllm" in stripped.lower():
        return CommandPolicyResult(True, "vLLM container launch")
    if "vllm.entrypoints.openai.api_server" in stripped:
        return CommandPolicyResult(True, "vLLM Python launch")
    return CommandPolicyResult(False, "only vLLM launch commands are allowed")


def build_tmux_start_command(session_name: str, command: str) -> str:
    return f"tmux new-session -d -s {shlex.quote(session_name)} -- bash -lc {shlex.quote(command)}"


def build_tmux_capture_command(session_name: str, limit: int = 160) -> str:
    return f"tmux capture-pane -p -t {shlex.quote(session_name)} -S -{int(limit)}"


def normalize_vllm_command_for_tmux(command: str) -> str:
    """Turn existing launch templates into a foreground process owned by tmux."""
    normalized = command.strip()
    normalized = re.sub(r"^nohup\s+", "", normalized)
    normalized = re.sub(r"\s+>\s*\S+\s+2>&1\s*&\s*$", "", normalized)
    normalized = re.sub(r"\s*&\s*$", "", normalized)
    normalized = re.sub(r"\bdocker\s+run\s+-d\b", "docker run --rm", normalized, count=1)
    normalized = normalized.replace("--restart unless-stopped ", "")
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _set_flag(command: str, flag: str, value: str) -> str:
    pattern = re.compile(rf"({re.escape(flag)}\s+)([^\s]+)")
    if pattern.search(command):
        return pattern.sub(rf"\g<1>{value}", command, count=1)
    return f"{command} {flag} {value}".strip()


def _extract_int_flag(command: str, flag: str) -> int | None:
    match = re.search(rf"{re.escape(flag)}\s+(\d+)", command)
    return int(match.group(1)) if match else None


def build_launch_variants(command: str, *, gpu_count: int = 1) -> list[dict]:
    base = normalize_vllm_command_for_tmux(command)
    max_model_len = _extract_int_flag(base, "--max-model-len") or 8192
    lengths = []
    for candidate in [max_model_len, min(max_model_len, 8192), min(max_model_len, 4096)]:
        if candidate > 0 and candidate not in lengths:
            lengths.append(candidate)
    mem_values = ["0.90", "0.86", "0.80"]

    variants: list[dict] = []
    seen: set[str] = set()
    for idx, ctx_len in enumerate(lengths[:3]):
        mem = mem_values[min(idx, len(mem_values) - 1)]
        candidate = _set_flag(base, "--max-model-len", str(ctx_len))
        candidate = _set_flag(candidate, "--gpu-memory-utilization", mem)
        if gpu_count <= 1:
            candidate = re.sub(r"\s+--tensor-parallel-size\s+\d+", "", candidate)
        if candidate in seen:
            continue
        seen.add(candidate)
        variants.append(
            {
                "name": "baseline" if idx == 0 else f"reduced-context-{ctx_len}",
                "command": candidate,
                "flags": {
                    "max_model_len": ctx_len,
                    "gpu_memory_utilization": float(mem),
                },
                "reason": "Start from the platform recommendation and reduce context/memory only on retry.",
            }
        )
    return variants


def success_from_checks(*, tmux_alive: bool, models_ok: bool, smoke_ok: bool) -> bool:
    return tmux_alive and models_ok and smoke_ok


def research_runtime_docs(query: str) -> dict:
    """Return curated official citations without making outbound calls."""
    q = query.lower()
    citations = []
    for citation in _OFFICIAL_CITATIONS:
        title = citation["title"].lower()
        if any(token in title or token in citation["url"].lower() for token in q.split()):
            citations.append(citation)
    if not citations:
        citations = _OFFICIAL_CITATIONS[:3]
    return {
        "query": query,
        "summary": "Official docs selected for vLLM serving, launch flags, tmux runtime ownership, and OpenAI-compatible smoke checks.",
        "citations": citations,
    }


def _exec(client, command: str, timeout: int) -> tuple[str, str, int]:
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    stdin.close()
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    return out, err, rc


def _bash_exec(client, command: str, timeout: int) -> tuple[str, str, int]:
    return _exec(client, f"bash -lc {shlex.quote(command)}", timeout)


def _expand_runtime_secrets(command: str, hf_token: str | None) -> str:
    return command.replace("$INFERIX_HF_TOKEN", shlex.quote(hf_token or ""))


class AgentTools:
    def __init__(
        self,
        *,
        client,
        hf_token: str | None,
        known_secrets: list[str],
        log: Callable[[str], None],
    ) -> None:
        self.client = client
        self.hf_token = hf_token
        self.known_secrets = known_secrets
        self.log = log

    def run_safe_shell(self, command: str, timeout: int = 30) -> dict:
        policy = validate_safe_shell_command(command)
        if not policy.allowed:
            return {"allowed": False, "blocked": True, "reason": policy.reason, "stdout": "", "stderr": "", "exit_code": None}
        out, err, rc = _bash_exec(self.client, command, timeout)
        return {
            "allowed": True,
            "blocked": False,
            "reason": policy.reason,
            "stdout": _tail(_mask(out, self.known_secrets)),
            "stderr": _tail(_mask(err, self.known_secrets)),
            "exit_code": rc,
        }

    def probe_host(self) -> dict:
        snapshot = capture_host_snapshot(self.client)
        return snapshot

    def tmux_has_session(self, session_name: str) -> bool:
        _, _, rc = _bash_exec(self.client, f"tmux has-session -t {shlex.quote(session_name)}", 10)
        return rc == 0

    def tmux_stop(self, session_name: str) -> dict:
        out, err, rc = _bash_exec(self.client, f"tmux kill-session -t {shlex.quote(session_name)}", 10)
        # tmux returns non-zero when the session does not exist; that is an idempotent stop.
        return {"stdout": _tail(_mask(out, self.known_secrets)), "stderr": _tail(_mask(err, self.known_secrets)), "exit_code": rc}

    def tmux_start(self, session_name: str, command: str) -> dict:
        policy = validate_launch_command(command)
        if not policy.allowed:
            return {"allowed": False, "blocked": True, "reason": policy.reason, "stdout": "", "stderr": "", "exit_code": None}
        expanded = _expand_runtime_secrets(command, self.hf_token)
        tmux_cmd = build_tmux_start_command(session_name, expanded)
        out, err, rc = _bash_exec(self.client, tmux_cmd, 15)
        return {
            "allowed": True,
            "blocked": False,
            "reason": policy.reason,
            "command": _mask(tmux_cmd, self.known_secrets),
            "stdout": _tail(_mask(out, self.known_secrets)),
            "stderr": _tail(_mask(err, self.known_secrets)),
            "exit_code": rc,
        }

    def tmux_capture(self, session_name: str) -> dict:
        out, err, rc = _bash_exec(self.client, build_tmux_capture_command(session_name), 10)
        return {"stdout": _tail(_mask(out, self.known_secrets)), "stderr": _tail(_mask(err, self.known_secrets)), "exit_code": rc}

    def check_openai_health(self, port: int) -> dict:
        cmd = f"curl -sS -m 5 http://127.0.0.1:{int(port)}/v1/models"
        result = self.run_safe_shell(cmd, timeout=8)
        ok = result.get("exit_code") == 0 and bool(str(result.get("stdout") or "").strip())
        model_id = None
        if ok:
            model_id = _extract_model_id(str(result.get("stdout") or ""))
        return {**result, "ok": ok, "model_id": model_id, "url": f"http://127.0.0.1:{int(port)}/v1/models"}

    def smoke_chat_completion(self, port: int, model: str) -> dict:
        payload = json.dumps(
            {
                "model": model,
                "messages": [{"role": "user", "content": "Say ok."}],
                "max_tokens": 8,
            },
            separators=(",", ":"),
        )
        cmd = (
            f"curl -sS -m 15 -X POST http://127.0.0.1:{int(port)}/v1/chat/completions "
            f"-H 'Content-Type: application/json' --data {shlex.quote(payload)}"
        )
        result = self.run_safe_shell(cmd, timeout=20)
        ok = result.get("exit_code") == 0 and _looks_like_chat_completion(str(result.get("stdout") or ""))
        return {**result, "ok": ok, "url": f"http://127.0.0.1:{int(port)}/v1/chat/completions"}


def _extract_model_id(text: str) -> str | None:
    try:
        data = json.loads(text)
        items = data.get("data") if isinstance(data, dict) else None
        if isinstance(items, list) and items:
            model_id = items[0].get("id")
            return str(model_id) if model_id else None
    except Exception:
        return None
    return None


def _looks_like_chat_completion(text: str) -> bool:
    try:
        data = json.loads(text)
    except Exception:
        return bool(text.strip())
    if not isinstance(data, dict):
        return False
    if data.get("error"):
        return False
    return bool(data.get("choices"))


def _initial_agent_steps() -> list[dict]:
    specs = [
        ("context_snapshot", "Build structured context", "preflight"),
        ("research_runtime_docs", "Research runtime docs", "preflight"),
        ("probe_host", "Probe host", "preflight"),
        ("launch_variant", "Launch vLLM in tmux", "launch"),
        ("health_models", "Check /v1/models", "verify"),
        ("smoke_completion", "Run chat smoke test", "verify"),
        ("record_success_candidate", "Record success artifact", "evidence"),
    ]
    return [
        jsonable_encoder(
            DeploymentPlanStep(
                id=step_id,
                title=title,
                stage=stage,
                command=None,
                auto_eligible=True,
                expected=None,
            )
        )
        for step_id, title, stage in specs
    ]


def _metadata(task_run: TaskRun) -> dict:
    return dict(task_run.metadata_json or {})


def _agent_meta(task_run: TaskRun) -> dict:
    metadata = _metadata(task_run)
    agent = dict(metadata.get("agent") or {})
    agent.setdefault("events", [])
    agent.setdefault("steps", _initial_agent_steps())
    agent.setdefault("health", {})
    return agent


def _write_agent_meta(task_run: TaskRun, db: Session, agent: dict) -> None:
    metadata = _metadata(task_run)
    metadata["agent"] = jsonable_encoder(agent)
    task_run.metadata_json = metadata
    db.commit()


def _append_event(
    *,
    task_run: TaskRun,
    db: Session,
    event_type: str,
    summary: str,
    tool: str | None = None,
    input: dict | None = None,
    output: dict | None = None,
    status: str = "ok",
    log: Callable[[str], None] | None = None,
) -> dict:
    agent = _agent_meta(task_run)
    event = {
        "id": uuid.uuid4().hex[:12],
        "ts": _now().isoformat(),
        "type": event_type,
        "summary": summary,
        "tool": tool,
        "input": input,
        "output": output,
        "status": status,
    }
    agent["events"] = [*agent.get("events", []), event][-400:]
    agent["reasoning_summary"] = summary
    _write_agent_meta(task_run, db, agent)
    if log:
        prefix = f"[{event_type}]"
        if tool:
            prefix += f" {tool}"
        log(f"{prefix} {summary}\n")
    return event


def _set_agent_step(task_run: TaskRun, db: Session, step_id: str, **patch) -> None:
    agent = _agent_meta(task_run)
    steps = list(agent.get("steps") or _initial_agent_steps())
    for idx, raw in enumerate(steps):
        if raw.get("id") != step_id:
            continue
        next_step = dict(raw)
        next_step.update(jsonable_encoder(patch))
        steps[idx] = next_step
        break
    agent["steps"] = steps
    _write_agent_meta(task_run, db, agent)


def _set_agent_fields(task_run: TaskRun, db: Session, **fields) -> None:
    agent = _agent_meta(task_run)
    agent.update(jsonable_encoder(fields))
    _write_agent_meta(task_run, db, agent)


def _cancel_requested(task_run: TaskRun, db: Session) -> bool:
    db.refresh(task_run)
    metadata = task_run.metadata_json or {}
    return bool(metadata.get("cancel_requested") or (metadata.get("agent") or {}).get("cancel_requested"))


def _model_ref(model: Model | None, quant: ModelQuant | None) -> str:
    return (quant.hf_repo if quant and quant.hf_repo else None) or (model.hf_repo if model else None) or (model.model_key if model else "default")


def _build_resources(
    *,
    db: Session,
    server_id: UUID,
    session_id: UUID | None,
    model_id: UUID,
    quant_id: UUID,
    engine: str,
    remote_port: int,
    runtime_mode: str,
) -> dict:
    server = db.query(Server).filter(Server.id == server_id).first()
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first() if session_id else None
    model = db.query(Model).filter(Model.id == model_id).first()
    quant = db.query(ModelQuant).filter(ModelQuant.id == quant_id).first()
    recommendation = recommend_launch(
        server_id=server_id,
        model_id=model_id,
        quant_id=quant_id,
        engine_str=engine,
        db=db,
        session_id=session_id,
        remote_port=remote_port,
    )
    plan = build_deployment_plan(
        db=db,
        server_id=server_id,
        model_id=model_id,
        quant_id=quant_id,
        session_id=session_id,
        engine=engine,
        remote_port=remote_port,
        runtime_mode=runtime_mode,
    )
    previous_runs = (
        db.query(ModelRunAttempt)
        .filter(
            ModelRunAttempt.model_id == model_id,
            ModelRunAttempt.quant_id == quant_id,
            ModelRunAttempt.succeeded == True,
        )
        .order_by(ModelRunAttempt.started_at.desc())
        .limit(5)
        .all()
    )
    snapshot = (session.metadata_json or {}).get("host_snapshot") if session else None
    return {
        "server": {
            "id": str(server.id) if server else str(server_id),
            "hostname": server.hostname if server else None,
            "gpu_model": server.gpu_model if server else None,
            "vram_gb": server.vram_gb if server else None,
            "status": server.status.value if server else None,
        },
        "session": {
            "id": str(session.id) if session else None,
            "status": session.status.value if session else None,
            "host_snapshot": snapshot,
        },
        "model": {
            "id": str(model.id) if model else str(model_id),
            "model_key": model.model_key if model else None,
            "name": model.name if model else None,
            "hf_repo": model.hf_repo if model else None,
            "recommended_flags": model.recommended_flags if model else None,
        },
        "quant": {
            "id": str(quant.id) if quant else str(quant_id),
            "name": quant.name if quant else None,
            "hf_repo": quant.hf_repo if quant else None,
            "quant_format": quant.quant_format if quant else None,
        },
        "recommendation": recommendation.model_dump(mode="json"),
        "deployment_plan": plan.model_dump(mode="json"),
        "previous_successful_runs": [
            {
                "id": str(run.id),
                "launch_command": run.launch_command,
                "duration_seconds": run.duration_seconds,
                "vram_used_gb": run.vram_used_gb,
                "started_at": run.started_at.isoformat() if run.started_at else None,
            }
            for run in previous_runs
        ],
    }


def _update_session_snapshot(db: Session, session_id: UUID, snapshot: dict) -> None:
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first()
    if not session:
        return
    metadata = dict(session.metadata_json or {})
    metadata["host_snapshot"] = snapshot
    session.metadata_json = metadata
    db.commit()


def _record_success_candidate(
    *,
    task_run: TaskRun,
    run: ModelRunAttempt,
    db: Session,
    tmux_session: str,
    launch_command: str,
    health: dict,
    evidence: dict,
    docs: dict,
    variant: dict,
) -> None:
    candidate = {
        "model_run_id": str(run.id),
        "tmux_session": tmux_session,
        "launch_command": launch_command,
        "health": health,
        "evidence": evidence,
        "docs": docs,
        "variant": variant,
        "captured_at": _now().isoformat(),
    }
    _set_agent_fields(
        task_run,
        db,
        success_candidate=candidate,
        success_ready=True,
        current_launch_command=launch_command,
        health=health,
    )


def run_agent_task(
    *,
    task_run_id: str,
    model_run_id: str,
    session_id: str,
    max_iterations: int,
    command_timeout_seconds: int,
    health_timeout_seconds: int,
) -> None:
    db = SessionLocal()
    log_file: str | None = None
    try:
        task_run = db.query(TaskRun).filter(TaskRun.id == UUID(task_run_id)).first()
        run = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == UUID(model_run_id)).first()
        if not task_run or not run:
            return

        log_file = _log_path(task_run_id)
        task_run.logs_path = log_file
        task_run.status = TaskStatus.RUNNING
        task_run.started_at = _utcnow()
        run.status = RunStatus.RUNNING
        db.commit()

        handle = session_store.get(session_id)
        if handle is None:
            raise RuntimeError("No active SSH handle for this session")

        hf_token = get_setting("hf_token", db)
        known_secrets = [hf_token] if hf_token else []
        request = (_metadata(task_run).get("request") or {})
        remote_port = int(request.get("remote_port") or 8000)
        runtime_mode = str(request.get("runtime_mode") or "auto")
        engine = str(request.get("engine") or run.engine.value)

        with open(log_file, "w", encoding="utf-8") as log_f:
            log = _make_logger(log_f)
            tools = AgentTools(client=handle.client, hf_token=hf_token, known_secrets=known_secrets, log=log)
            tmux_session = model_tmux_session_name(run.id)
            _set_agent_fields(task_run, db, tmux_session=tmux_session, success_ready=False)
            log("[inferix-agent] starting guarded Lab agent run\n\n")

            _set_agent_step(task_run, db, "context_snapshot", status="RUNNING", started_at=_now())
            resources = _build_resources(
                db=db,
                server_id=run.server_id,
                session_id=UUID(session_id),
                model_id=run.model_id,
                quant_id=run.quant_id,
                engine=engine,
                remote_port=remote_port,
                runtime_mode=runtime_mode,
            )
            _set_agent_fields(task_run, db, resources=resources)
            _append_event(
                task_run=task_run,
                db=db,
                event_type="reasoning",
                summary="Built model, quant, host, stack, and prior-run resources for the agent loop.",
                output={"resource_keys": list(resources.keys())},
                log=log,
            )
            _set_agent_step(task_run, db, "context_snapshot", status="SUCCESS", finished_at=_now())

            _set_agent_step(task_run, db, "research_runtime_docs", status="RUNNING", started_at=_now())
            docs = research_runtime_docs("vLLM tmux OpenAI health smoke chat completions")
            _set_agent_fields(task_run, db, citations=docs["citations"])
            _append_event(
                task_run=task_run,
                db=db,
                event_type="tool_call",
                tool="research_runtime_docs",
                summary="Collected official runtime citations for launch and verification decisions.",
                input={"query": docs["query"]},
                output=docs,
                log=log,
            )
            _set_agent_step(task_run, db, "research_runtime_docs", status="SUCCESS", finished_at=_now())

            if _cancel_requested(task_run, db):
                raise AgentCancelled("Agent run cancelled before host probe")

            _set_agent_step(task_run, db, "probe_host", status="RUNNING", started_at=_now())
            snapshot = tools.probe_host()
            _update_session_snapshot(db, UUID(session_id), snapshot)
            _append_event(
                task_run=task_run,
                db=db,
                event_type="tool_call",
                tool="probe_host",
                summary="Captured current GPU, CUDA, Docker, and tmux-relevant host facts.",
                output={"gpu_count": snapshot.get("gpu_count"), "docker_present": snapshot.get("docker_present")},
                log=log,
            )
            _set_agent_step(task_run, db, "probe_host", status="SUCCESS", finished_at=_now())

            resources = _build_resources(
                db=db,
                server_id=run.server_id,
                session_id=UUID(session_id),
                model_id=run.model_id,
                quant_id=run.quant_id,
                engine=engine,
                remote_port=remote_port,
                runtime_mode=runtime_mode,
            )
            recommendation = resources["recommendation"]
            launch_command = recommendation.get("injectable_command") or ""
            if not launch_command:
                warnings = "; ".join(recommendation.get("warnings") or [])
                raise RuntimeError(warnings or "No vLLM launch command could be generated")

            gpu_count = int((resources.get("session", {}).get("host_snapshot") or {}).get("gpu_count") or 1)
            variants = build_launch_variants(launch_command, gpu_count=gpu_count)
            _set_agent_fields(task_run, db, resources=resources, launch_variants=variants)
            run.launch_plan_json = resources
            run.launch_command = normalize_vllm_command_for_tmux(launch_command)
            db.commit()

            model = db.query(Model).filter(Model.id == run.model_id).first()
            quant = db.query(ModelQuant).filter(ModelQuant.id == run.quant_id).first()
            fallback_model_ref = _model_ref(model, quant)

            success = False
            last_error = "Agent exhausted launch variants"
            for idx, variant in enumerate(variants[: max(1, max_iterations)]):
                if _cancel_requested(task_run, db):
                    raise AgentCancelled("Agent run cancelled")

                command = variant["command"]
                run.launch_command = command
                db.commit()
                _set_agent_fields(task_run, db, current_launch_command=command, active_variant=variant)
                _set_agent_step(task_run, db, "launch_variant", status="RUNNING", started_at=_now(), command=command)
                _append_event(
                    task_run=task_run,
                    db=db,
                    event_type="reasoning",
                    summary=f"Trying launch variant {idx + 1}/{min(len(variants), max_iterations)}: {variant['name']}.",
                    output={"flags": variant.get("flags")},
                    log=log,
                )

                stop_result = tools.tmux_stop(tmux_session)
                _append_event(
                    task_run=task_run,
                    db=db,
                    event_type="tool_call",
                    tool="tmux_stop",
                    summary="Stopped any existing managed tmux session before relaunch.",
                    input={"session_name": tmux_session},
                    output=stop_result,
                    log=log,
                )

                start_result = tools.tmux_start(tmux_session, command)
                _append_event(
                    task_run=task_run,
                    db=db,
                    event_type="tool_call",
                    tool="tmux_start",
                    summary="Started vLLM inside the managed tmux session.",
                    input={"session_name": tmux_session, "command": _mask(command, known_secrets)},
                    output=start_result,
                    status="ok" if start_result.get("exit_code") == 0 else "failed",
                    log=log,
                )
                if start_result.get("exit_code") != 0:
                    last_error = start_result.get("stderr") or start_result.get("stdout") or "tmux_start failed"
                    _set_agent_step(task_run, db, "launch_variant", status="FAILED", finished_at=_now(), error=last_error)
                    continue
                _set_agent_step(task_run, db, "launch_variant", status="SUCCESS", finished_at=_now(), stdout_tail=start_result.get("stdout", ""))

                deadline = time.monotonic() + max(15, health_timeout_seconds)
                last_health: dict = {}
                last_smoke: dict = {}
                while time.monotonic() < deadline:
                    if _cancel_requested(task_run, db):
                        raise AgentCancelled("Agent run cancelled")

                    capture = tools.tmux_capture(tmux_session)
                    tmux_tail = str(capture.get("stdout") or "")
                    _set_agent_fields(task_run, db, tmux_output_tail=tmux_tail)

                    tmux_alive = tools.tmux_has_session(tmux_session)
                    _set_agent_step(task_run, db, "health_models", status="RUNNING", started_at=_now())
                    last_health = tools.check_openai_health(remote_port)
                    health_ok = bool(last_health.get("ok"))
                    smoke_ok = False
                    if health_ok:
                        model_for_smoke = str(last_health.get("model_id") or fallback_model_ref)
                        _set_agent_step(task_run, db, "smoke_completion", status="RUNNING", started_at=_now())
                        last_smoke = tools.smoke_chat_completion(remote_port, model_for_smoke)
                        smoke_ok = bool(last_smoke.get("ok"))

                    health_state = {
                        "tmux_alive": tmux_alive,
                        "models_ok": health_ok,
                        "smoke_ok": smoke_ok,
                        "models_url": last_health.get("url"),
                        "smoke_url": last_smoke.get("url"),
                        "model_id": last_health.get("model_id") or fallback_model_ref,
                    }
                    _set_agent_fields(task_run, db, health=health_state)
                    if success_from_checks(tmux_alive=tmux_alive, models_ok=health_ok, smoke_ok=smoke_ok):
                        _set_agent_step(task_run, db, "health_models", status="SUCCESS", finished_at=_now(), stdout_tail=str(last_health.get("stdout") or ""))
                        _set_agent_step(task_run, db, "smoke_completion", status="SUCCESS", finished_at=_now(), stdout_tail=str(last_smoke.get("stdout") or ""))
                        evidence = {
                            "nvidia_smi": tools.run_safe_shell("nvidia-smi --query-gpu=name,memory.used,utilization.gpu --format=csv", timeout=12),
                            "docker_ps": tools.run_safe_shell("docker ps", timeout=12),
                            "tmux_capture": capture,
                        }
                        _record_success_candidate(
                            task_run=task_run,
                            run=run,
                            db=db,
                            tmux_session=tmux_session,
                            launch_command=command,
                            health=health_state,
                            evidence=evidence,
                            docs=docs,
                            variant=variant,
                        )
                        _append_event(
                            task_run=task_run,
                            db=db,
                            event_type="tool_call",
                            tool="record_success_candidate",
                            summary="Success criteria passed and the reusable launch artifact was recorded.",
                            output={"tmux_session": tmux_session, "model_id": health_state["model_id"]},
                            log=log,
                        )
                        _set_agent_step(task_run, db, "record_success_candidate", status="SUCCESS", finished_at=_now())
                        run.status = RunStatus.SUCCESS
                        run.succeeded = True
                        run.health_check_ok = True
                        run.health_check_url = str(last_health.get("url"))
                        task_run.status = TaskStatus.SUCCESS
                        success = True
                        db.commit()
                        break

                    last_error = (
                        str(last_smoke.get("stderr") or last_smoke.get("stdout") or "")
                        or str(last_health.get("stderr") or last_health.get("stdout") or "")
                        or ("tmux session exited before health passed" if not tmux_alive else "health check pending")
                    )
                    if not tmux_alive:
                        break
                    time.sleep(5)

                if success:
                    break
                _set_agent_step(task_run, db, "health_models", status="FAILED", finished_at=_now(), error=_tail(last_error, 1000))
                _set_agent_step(task_run, db, "smoke_completion", status="FAILED", finished_at=_now(), error=_tail(last_error, 1000))
                _append_event(
                    task_run=task_run,
                    db=db,
                    event_type="reasoning",
                    summary=f"Launch variant {variant['name']} did not satisfy health and smoke checks.",
                    output={"error": _tail(last_error, 1200)},
                    status="failed",
                    log=log,
                )

            if not success:
                run.status = RunStatus.FAILED
                run.succeeded = False
                run.failure_stage = FailureStage.HEALTH_CHECK
                run.failure_message = _tail(last_error, 4000)
                task_run.status = TaskStatus.FAILED
                task_run.error_summary = run.failure_message
                db.commit()

    except AgentCancelled as exc:
        task_run = db.query(TaskRun).filter(TaskRun.id == UUID(task_run_id)).first()
        run = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == UUID(model_run_id)).first()
        if task_run:
            task_run.status = TaskStatus.FAILED
            task_run.error_summary = str(exc)
            _set_agent_fields(task_run, db, cancel_requested=True)
        if run:
            run.status = RunStatus.ABANDONED
            run.succeeded = False
            run.failure_message = str(exc)
        db.commit()
    except Exception as exc:
        logger.exception("Lab agent run failed")
        task_run = db.query(TaskRun).filter(TaskRun.id == UUID(task_run_id)).first()
        run = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == UUID(model_run_id)).first()
        if task_run:
            task_run.status = TaskStatus.FAILED
            task_run.error_summary = str(exc)
            try:
                _append_event(
                    task_run=task_run,
                    db=db,
                    event_type="reasoning",
                    summary=f"Agent run failed: {exc}",
                    status="failed",
                )
            except Exception:
                pass
        if run:
            run.status = RunStatus.FAILED
            run.succeeded = False
            run.failure_stage = FailureStage.OTHER
            run.failure_message = str(exc)[:4000]
        db.commit()
        if log_file:
            try:
                with open(log_file, "a", encoding="utf-8") as log_f:
                    log_f.write(f"\nERROR: {exc}\n")
            except Exception:
                pass
    finally:
        task_run = db.query(TaskRun).filter(TaskRun.id == UUID(task_run_id)).first()
        run = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == UUID(model_run_id)).first()
        if run:
            now = _now()
            run.completed_at = now
            if run.started_at:
                run.duration_seconds = max(0, int((now - run.started_at).total_seconds()))
        if task_run:
            _finish_task_run(task_run, db)
        db.close()


class AgentCancelled(RuntimeError):
    pass


def agent_status_response(task_run: TaskRun) -> AgentRunStatusResponse:
    metadata = task_run.metadata_json or {}
    agent = metadata.get("agent") or {}
    events = [AgentRunEvent.model_validate(event) for event in (agent.get("events") or [])]
    model_run_id = agent.get("model_run_id") or metadata.get("model_run_id")
    playbook_id = agent.get("playbook_id")
    return AgentRunStatusResponse(
        task_run_id=task_run.id,
        model_run_id=UUID(model_run_id) if model_run_id else None,
        status=task_run.status.value if hasattr(task_run.status, "value") else str(task_run.status),
        error_summary=task_run.error_summary,
        tmux_session=agent.get("tmux_session"),
        cancel_requested=bool(metadata.get("cancel_requested") or agent.get("cancel_requested")),
        current_launch_command=agent.get("current_launch_command"),
        reasoning_summary=agent.get("reasoning_summary"),
        health=agent.get("health") or {},
        success_ready=bool(agent.get("success_ready")),
        playbook_id=UUID(playbook_id) if playbook_id else None,
        tmux_output_tail=agent.get("tmux_output_tail") or "",
        events=events,
        steps=[DeploymentPlanStep.model_validate(step) for step in (agent.get("steps") or [])],
    )


def request_cancel_agent_run(task_run: TaskRun, db: Session) -> AgentRunStatusResponse:
    metadata = dict(task_run.metadata_json or {})
    agent = dict(metadata.get("agent") or {})
    metadata["cancel_requested"] = True
    agent["cancel_requested"] = True
    metadata["agent"] = agent
    task_run.metadata_json = metadata
    db.commit()

    session_id = metadata.get("session_id") or agent.get("session_id")
    tmux_session = agent.get("tmux_session")
    if session_id and tmux_session:
        handle = session_store.get(str(session_id))
        if handle is not None:
            try:
                _bash_exec(handle.client, f"tmux kill-session -t {shlex.quote(str(tmux_session))}", 10)
            except Exception:
                pass
    db.refresh(task_run)
    return agent_status_response(task_run)


def approve_agent_tool(task_run: TaskRun, db: Session, tool_call_id: str, approved: bool, note: str | None) -> None:
    metadata = dict(task_run.metadata_json or {})
    agent = dict(metadata.get("agent") or {})
    approvals = dict(agent.get("tool_approvals") or {})
    approvals[tool_call_id] = {"approved": approved, "note": note, "decided_at": _now().isoformat()}
    agent["tool_approvals"] = approvals
    metadata["agent"] = agent
    task_run.metadata_json = metadata
    db.commit()


def promote_agent_playbook(task_run: TaskRun, db: Session) -> PromotePlaybookResponse:
    metadata = task_run.metadata_json or {}
    agent = metadata.get("agent") or {}
    candidate = agent.get("success_candidate")
    model_run_id = agent.get("model_run_id") or metadata.get("model_run_id")
    run = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == UUID(model_run_id)).first() if model_run_id else None
    if not candidate or not agent.get("success_ready") or not run or run.succeeded is not True:
        raise ValueError("Only successful agent runs can be promoted to playbooks")

    resources = agent.get("resources") or {}
    setup_sh, ansible_yaml = _render_playbook_artifacts(candidate=candidate, resources=resources)
    model = db.query(Model).filter(Model.id == run.model_id).first()
    quant = db.query(ModelQuant).filter(ModelQuant.id == run.quant_id).first()
    name = f"agent {model.name if model else 'model'} {quant.name if quant else 'quant'} vllm"

    write_result = write_playbook_to_local_repo(
        name=name,
        setup_sh=setup_sh,
        ansible_yaml=ansible_yaml,
        session_id=str(run.session_id) if run.session_id else None,
    )
    playbook = Playbook(
        name=name,
        git_repo=write_result["git_repo"],
        git_branch="main",
        git_commit=write_result.get("git_commit"),
        tags={"source": "lab_agent", "task_run_id": str(task_run.id), "model_run_id": str(run.id)},
        requirements_json={
            "model_run_attempt_id": str(run.id),
            "task_run_id": str(task_run.id),
            "success_candidate": candidate,
        },
        engine=run.engine if isinstance(run.engine, EngineKind) else None,
        source_session_id=run.session_id,
    )
    db.add(playbook)
    db.flush()

    db.add(
        PlaybookRunOutcome(
            playbook_id=playbook.id,
            task_run_id=task_run.id,
            server_id=run.server_id,
            model_variant_id=None,
            succeeded=True,
            duration_seconds=run.duration_seconds,
        )
    )
    agent["playbook_id"] = str(playbook.id)
    metadata = dict(metadata)
    metadata["agent"] = agent
    task_run.metadata_json = metadata
    run.published_url = write_result["git_repo"]
    run.published_sha = write_result.get("git_commit")
    run.published_at = _now()
    db.commit()
    return PromotePlaybookResponse(
        playbook_id=playbook.id,
        git_repo=write_result["git_repo"],
        git_commit=write_result.get("git_commit"),
    )


def _render_playbook_artifacts(*, candidate: dict, resources: dict) -> tuple[str, str]:
    plan_steps = ((resources.get("deployment_plan") or {}).get("steps") or [])
    setup_commands: list[str] = []
    for step in plan_steps:
        if step.get("stage") in {"setup", "runtime", "model"} and step.get("command"):
            setup_commands.append(str(step["command"]))
    launch_command = str(candidate.get("launch_command") or "")
    tmux_session = str(candidate.get("tmux_session") or "inferix-model")
    port = str(((resources.get("deployment_plan") or {}).get("remote_port")) or 8000)
    model_id = str((candidate.get("health") or {}).get("model_id") or "default")

    tmux_launch = build_tmux_start_command(tmux_session, launch_command)
    health_command = f"curl -sf http://127.0.0.1:{port}/v1/models"
    smoke_payload = json.dumps({"model": model_id, "messages": [{"role": "user", "content": "Say ok."}], "max_tokens": 8})
    smoke_command = (
        f"curl -sf -X POST http://127.0.0.1:{port}/v1/chat/completions "
        f"-H 'Content-Type: application/json' --data {shlex.quote(smoke_payload)}"
    )

    setup_lines = ["#!/usr/bin/env bash", "set -euo pipefail", ""]
    setup_lines.extend(setup_commands)
    setup_lines.extend(
        [
            "",
            f"tmux kill-session -t {shlex.quote(tmux_session)} 2>/dev/null || true",
            tmux_launch,
            health_command,
            smoke_command,
            "nvidia-smi --query-gpu=name,memory.used,utilization.gpu --format=csv || true",
        ]
    )

    def yaml_block(command: str, indent: str = "        ") -> str:
        return "\n".join(f"{indent}{line}" for line in command.splitlines())

    tasks = []
    for idx, command in enumerate(setup_commands, start=1):
        tasks.append(f"    - name: Setup step {idx}\n      shell: |\n{yaml_block(command)}")
    tasks.extend(
        [
            f"    - name: Stop previous managed tmux session\n      shell: tmux kill-session -t {shlex.quote(tmux_session)} 2>/dev/null || true\n      failed_when: false",
            f"    - name: Launch vLLM in tmux\n      shell: |\n{yaml_block(tmux_launch)}",
            f"    - name: Check OpenAI-compatible models endpoint\n      shell: {health_command}",
            f"    - name: Run chat smoke test\n      shell: |\n{yaml_block(smoke_command)}",
            "    - name: Capture GPU evidence\n      shell: nvidia-smi --query-gpu=name,memory.used,utilization.gpu --format=csv || true\n      changed_when: false",
        ]
    )
    ansible_yaml = "---\n- hosts: all\n  become: false\n  tasks:\n" + "\n".join(tasks) + "\n"
    return "\n".join(setup_lines) + "\n", ansible_yaml
