"""In-process reverse proxy and usage accounting for deployed models."""

from __future__ import annotations

import json
import logging
import shlex
import time
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.entities import InferenceProxyMetric, InferenceProxyRoute, ModelRunAttempt, TaskRun
from app.schemas.inference_proxy import InferenceProxyMetricSummary
from app.services import session_store

logger = logging.getLogger(__name__)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def route_slug_for(server_id: UUID, remote_port: int) -> str:
    return f"srv-{str(server_id).replace('-', '')[:12]}-{int(remote_port)}"


def _session_id_for_run(db: Session, model_run_id: UUID | None, task_run_id: UUID | None) -> UUID | None:
    if model_run_id:
        run = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == model_run_id).first()
        if run and run.session_id:
            return run.session_id
    if task_run_id:
        task = db.query(TaskRun).filter(TaskRun.id == task_run_id).first()
        metadata = task.metadata_json if task else None
        if isinstance(metadata, dict) and metadata.get("session_id"):
            try:
                return UUID(str(metadata["session_id"]))
            except ValueError:
                return None
    return None


def register_lab_route(
    db: Session,
    *,
    server_id: UUID,
    model_id: UUID,
    quant_id: UUID,
    repo_id: str,
    port: int,
    profile: dict | None = None,
    task_run_id: UUID | None = None,
    model_run_id: UUID | None = None,
) -> InferenceProxyRoute:
    """Upsert the proxy route for the model Lab just marked as healthy."""
    slug = route_slug_for(server_id, port)
    now = utcnow()
    target_base_url = f"http://127.0.0.1:{int(port)}/v1"
    route = None
    if model_run_id:
        route = db.query(InferenceProxyRoute).filter(InferenceProxyRoute.model_run_id == model_run_id).first()
    if route is None:
        route = db.query(InferenceProxyRoute).filter(InferenceProxyRoute.route_slug == slug).first()

    # Lab currently has one active model per server. Keep older routes for
    # history, but prevent them from advertising as live.
    db.query(InferenceProxyRoute).filter(
        InferenceProxyRoute.server_id == server_id,
        InferenceProxyRoute.route_slug != slug,
        InferenceProxyRoute.status == "active",
    ).update({"status": "inactive"}, synchronize_session=False)

    if route is None:
        route = InferenceProxyRoute(
            route_slug=slug,
            server_id=server_id,
            remote_port=int(port),
            model_name=repo_id,
            target_base_url=target_base_url,
            status="active",
        )
        db.add(route)

    route.server_id = server_id
    route.session_id = _session_id_for_run(db, model_run_id, task_run_id)
    route.model_id = model_id
    route.quant_id = quant_id
    route.model_run_id = model_run_id
    route.model_name = repo_id
    route.target_base_url = target_base_url
    route.remote_port = int(port)
    route.profile_json = profile or None
    route.status = "active"
    route.last_seen_at = now
    return route


def deactivate_routes_for_server(db: Session, server_id: UUID) -> int:
    return db.query(InferenceProxyRoute).filter(
        InferenceProxyRoute.server_id == server_id,
        InferenceProxyRoute.status == "active",
    ).update({"status": "inactive"}, synchronize_session=False)


def list_active_routes(db: Session) -> list[InferenceProxyRoute]:
    return (
        db.query(InferenceProxyRoute)
        .filter(InferenceProxyRoute.status == "active")
        .order_by(InferenceProxyRoute.updated_at.desc())
        .all()
    )


def categorize_request(path: str, body: dict[str, Any] | None) -> str:
    path_lower = path.lower()
    if "batch" in path_lower or "embeddings" in path_lower:
        return "batch"
    if body:
        messages = body.get("messages")
        if body.get("tools") or body.get("tool_choice"):
            return "agentic"
        if isinstance(messages, list) and any(isinstance(m, dict) and m.get("role") == "tool" for m in messages):
            return "agentic"
    return "chat" if "chat" in path_lower else "api"


def estimate_tokens(text: str) -> int:
    stripped = text.strip()
    if not stripped:
        return 0
    return max(1, int(len(stripped) / 4))


def estimate_prompt_tokens(body: dict[str, Any] | None) -> int | None:
    if not body:
        return None
    messages = body.get("messages")
    if isinstance(messages, list):
        total = 0
        for msg in messages:
            if isinstance(msg, dict):
                total += estimate_tokens(str(msg.get("content") or ""))
        return total
    if isinstance(body.get("prompt"), str):
        return estimate_tokens(str(body["prompt"]))
    return None


def usage_from_json_response(data: dict[str, Any], body: dict[str, Any] | None) -> tuple[int | None, int | None, int | None, str]:
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    input_tokens = usage.get("prompt_tokens") or usage.get("input_tokens")
    output_tokens = usage.get("completion_tokens") or usage.get("output_tokens")
    total_tokens = usage.get("total_tokens")
    output_text = ""
    if output_tokens is None:
        try:
            output_text = data["choices"][0]["message"].get("content") or ""
            output_tokens = estimate_tokens(output_text)
        except Exception:
            output_tokens = None
    if input_tokens is None:
        input_tokens = estimate_prompt_tokens(body)
    if total_tokens is None and (input_tokens is not None or output_tokens is not None):
        total_tokens = int(input_tokens or 0) + int(output_tokens or 0)
    return (
        int(input_tokens) if input_tokens is not None else None,
        int(output_tokens) if output_tokens is not None else None,
        int(total_tokens) if total_tokens is not None else None,
        output_text,
    )


def usage_from_stream(stream_text: str, body: dict[str, Any] | None) -> tuple[int | None, int | None, int | None, str]:
    usage: dict[str, Any] = {}
    output_parts: list[str] = []
    for line in stream_text.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line.removeprefix("data:").strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            chunk = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if isinstance(chunk.get("usage"), dict):
            usage = chunk["usage"]
        for choice in chunk.get("choices") or []:
            if not isinstance(choice, dict):
                continue
            delta = choice.get("delta") if isinstance(choice.get("delta"), dict) else {}
            content = delta.get("content")
            if isinstance(content, str):
                output_parts.append(content)
    output_text = "".join(output_parts)
    input_tokens = usage.get("prompt_tokens") or usage.get("input_tokens") or estimate_prompt_tokens(body)
    output_tokens = usage.get("completion_tokens") or usage.get("output_tokens") or estimate_tokens(output_text)
    total_tokens = usage.get("total_tokens")
    if total_tokens is None and (input_tokens is not None or output_tokens is not None):
        total_tokens = int(input_tokens or 0) + int(output_tokens or 0)
    return (
        int(input_tokens) if input_tokens is not None else None,
        int(output_tokens) if output_tokens is not None else None,
        int(total_tokens) if total_tokens is not None else None,
        output_text,
    )


def _compute_cost(route: InferenceProxyRoute, latency_ms: int, total_tokens: int | None) -> tuple[float | None, float | None]:
    if not route.hourly_cost_usd:
        return None, None
    estimated_cost = (max(0, latency_ms) / 1000 / 3600) * route.hourly_cost_usd
    effectiveness = (total_tokens / estimated_cost) if estimated_cost > 0 and total_tokens else None
    return estimated_cost, effectiveness


def record_metric(
    db: Session,
    route: InferenceProxyRoute,
    *,
    method: str,
    path: str,
    category: str,
    status_code: int | None,
    input_tokens: int | None,
    output_tokens: int | None,
    total_tokens: int | None,
    latency_ms: int,
    ttft_ms: int | None = None,
    tokens_per_second: float | None = None,
) -> InferenceProxyMetric:
    estimated_cost, effectiveness = _compute_cost(route, latency_ms, total_tokens)
    metric = InferenceProxyMetric(
        route_id=route.id,
        server_id=route.server_id,
        model_run_id=route.model_run_id,
        category=category,
        method=method.upper(),
        path=path[:512],
        status_code=status_code,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        latency_ms=latency_ms,
        ttft_ms=ttft_ms,
        tokens_per_second=tokens_per_second,
        estimated_cost_usd=estimated_cost,
        effectiveness_score=effectiveness,
    )
    route.last_seen_at = utcnow()
    db.add(metric)
    db.commit()
    return metric


def metric_summary(db: Session, server_id: UUID | None = None) -> InferenceProxyMetricSummary:
    now = utcnow()
    since_day = now - timedelta(hours=24)
    since_minute = now - timedelta(minutes=1)
    query = db.query(InferenceProxyMetric).filter(InferenceProxyMetric.created_at >= since_day)
    if server_id:
        query = query.filter(InferenceProxyMetric.server_id == server_id)
    rows = query.all()

    def aware(value: datetime) -> datetime:
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)

    minute_rows = [row for row in rows if row.created_at and aware(row.created_at) >= since_minute]

    def avg(values: list[float]) -> float | None:
        return round(sum(values) / len(values), 2) if values else None

    by_category: dict[str, int] = {}
    for row in rows:
        by_category[row.category] = by_category.get(row.category, 0) + 1

    total_costs = [row.estimated_cost_usd for row in rows if row.estimated_cost_usd is not None]
    estimated_cost = round(sum(total_costs), 6) if total_costs else None
    total_tokens = sum(row.total_tokens or 0 for row in rows)
    effectiveness = round(total_tokens / estimated_cost, 2) if estimated_cost and estimated_cost > 0 else None

    return InferenceProxyMetricSummary(
        requests_last_minute=len(minute_rows),
        requests_24h=len(rows),
        input_tokens_24h=sum(row.input_tokens or 0 for row in rows),
        output_tokens_24h=sum(row.output_tokens or 0 for row in rows),
        total_tokens_24h=total_tokens,
        avg_latency_ms_24h=avg([float(row.latency_ms) for row in rows]),
        avg_ttft_ms_24h=avg([float(row.ttft_ms) for row in rows if row.ttft_ms is not None]),
        avg_tokens_per_second_24h=avg([float(row.tokens_per_second) for row in rows if row.tokens_per_second is not None]),
        estimated_cost_usd_24h=estimated_cost,
        effectiveness_score_24h=effectiveness,
        by_category_24h=by_category,
    )


def _curl_command(method: str, url: str, body_text: str | None, stream: bool) -> str:
    flags = "-sS -N" if stream else "-sS"
    parts = [
        "curl",
        flags,
        "--max-time",
        "600",
        "-X",
        shlex.quote(method.upper()),
        "-H",
        shlex.quote("Content-Type: application/json"),
        shlex.quote(url),
    ]
    if body_text is not None:
        return f"printf %s {shlex.quote(body_text)} | {' '.join(parts)} -d @-"
    return " ".join(parts)


def proxy_json_request(
    db: Session,
    route: InferenceProxyRoute,
    *,
    method: str,
    path: str,
    body: dict[str, Any] | None,
) -> tuple[bytes, int, str]:
    if not route.session_id:
        raise RuntimeError("No active SSH session is associated with this route")
    handle = session_store.get(str(route.session_id))
    if handle is None:
        raise RuntimeError("No active SSH handle for this route")

    body_text = json.dumps(body, separators=(",", ":")) if body is not None else None
    target_url = f"{route.target_base_url.rstrip('/')}/{path.lstrip('/')}"
    command = (
        _curl_command(method, target_url, body_text, stream=False)
        + " -w '\\n__HTTP_STATUS__:%{http_code}'"
    )
    started = time.monotonic()
    stdin, stdout, stderr = handle.client.exec_command(command, timeout=660)
    stdin.close()
    raw = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    latency_ms = int((time.monotonic() - started) * 1000)
    if rc != 0:
        raise RuntimeError((err or raw or f"curl exited {rc}")[:1000])

    marker = "\n__HTTP_STATUS__:"
    if marker in raw:
        raw_body, raw_status = raw.rsplit(marker, 1)
        try:
            status_code = int(raw_status.strip().splitlines()[0])
        except (ValueError, IndexError):
            status_code = 502
    else:
        raw_body, status_code = raw, 200

    category = categorize_request(path, body)
    input_tokens = output_tokens = total_tokens = None
    tps = None
    try:
        parsed = json.loads(raw_body)
        input_tokens, output_tokens, total_tokens, _ = usage_from_json_response(parsed, body)
        if output_tokens is not None and latency_ms > 0:
            tps = round(output_tokens / (latency_ms / 1000), 2)
    except json.JSONDecodeError:
        pass
    record_metric(
        db,
        route,
        method=method,
        path=path,
        category=category,
        status_code=status_code,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total_tokens,
        latency_ms=latency_ms,
        tokens_per_second=tps,
    )
    return raw_body.encode(), status_code, "application/json"


def proxy_stream_request(
    db_factory,
    route_id: UUID,
    *,
    method: str,
    path: str,
    body: dict[str, Any] | None,
) -> Iterator[bytes]:
    """Stream an upstream SSE response through SSH curl and record metrics at EOF."""
    body_text = json.dumps(body, separators=(",", ":")) if body is not None else None
    db = db_factory()
    route = db.query(InferenceProxyRoute).filter(InferenceProxyRoute.id == route_id).first()
    if not route:
        db.close()
        yield b'data: {"error":"Route no longer exists"}\n\n'
        return
    if not route.session_id:
        db.close()
        yield b'data: {"error":"No active SSH session is associated with this route"}\n\n'
        return
    handle = session_store.get(str(route.session_id))
    if handle is None:
        db.close()
        yield b'data: {"error":"No active SSH handle for this route"}\n\n'
        return

    target_url = f"{route.target_base_url.rstrip('/')}/{path.lstrip('/')}"
    command = _curl_command(method, target_url, body_text, stream=True)
    started = time.monotonic()
    first_chunk_at: float | None = None
    chunks: list[str] = []
    status_code = 200
    try:
        stdin, stdout, stderr = handle.client.exec_command(command, timeout=660)
        stdin.close()
        channel = stdout.channel
        while True:
            if channel.recv_ready():
                data = channel.recv(4096)
                if data:
                    if first_chunk_at is None:
                        first_chunk_at = time.monotonic()
                    text = data.decode(errors="replace")
                    chunks.append(text)
                    yield data
            if channel.exit_status_ready():
                while channel.recv_ready():
                    data = channel.recv(4096)
                    if data:
                        chunks.append(data.decode(errors="replace"))
                        yield data
                break
            time.sleep(0.02)
        rc = channel.recv_exit_status()
        if rc != 0:
            status_code = 502
            err = stderr.read().decode(errors="replace")
            logger.warning("Proxy stream curl exited %s: %s", rc, err[:500])
    finally:
        latency_ms = int((time.monotonic() - started) * 1000)
        ttft_ms = int((first_chunk_at - started) * 1000) if first_chunk_at else None
        stream_text = "".join(chunks)
        input_tokens, output_tokens, total_tokens, _ = usage_from_stream(stream_text, body)
        elapsed_after_first = max(0.001, (time.monotonic() - (first_chunk_at or started)))
        tps = round((output_tokens or 0) / elapsed_after_first, 2) if output_tokens else None
        try:
            record_metric(
                db,
                route,
                method=method,
                path=path,
                category=categorize_request(path, body),
                status_code=status_code,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                latency_ms=latency_ms,
                ttft_ms=ttft_ms,
                tokens_per_second=tps,
            )
        except Exception:
            logger.exception("Failed to record proxy stream metric")
        finally:
            db.close()
