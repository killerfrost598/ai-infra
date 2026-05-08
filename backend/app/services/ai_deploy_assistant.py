"""AI-assisted deployment guidance for Lab.

The assistant is advisory only: it produces commands/checklists for an operator
to review. Execution stays in the platform's deployment pipeline.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.models.entities import Model, ModelQuant, Server
from app.models.entities import Session as SessionModel
from app.schemas.lab import LaunchRecommendation
from app.services.settings_service import get_setting


SYSTEM_PROMPT = """You are helping an operator deploy an open-source LLM on a rented GPU host.
Use only the supplied platform facts. Do not invent GPU specs, model metadata, or installed tools.
Return a concise operator runbook with:
1. Risk summary.
2. Required preflight checks.
3. Runtime setup commands for Docker-first vLLM, or uv-managed venv fallback if Docker/NVIDIA Container Toolkit is absent.
4. Explicit model download/cache step.
5. Launch command.
6. Health check and smoke test.
7. What evidence to save back to the platform.
Prefer commands that are idempotent and explain any assumption next to the command."""


def build_deploy_context(
    *,
    db: Session,
    server_id: Any,
    model_id: Any,
    quant_id: Any,
    session_id: Any | None,
    recommendation: LaunchRecommendation,
    operator_goal: str,
) -> dict[str, Any]:
    server = db.query(Server).filter(Server.id == server_id).first()
    model = db.query(Model).filter(Model.id == model_id).first()
    quant = db.query(ModelQuant).filter(ModelQuant.id == quant_id).first()
    session = db.query(SessionModel).filter(SessionModel.id == session_id).first() if session_id else None
    snapshot = (session.metadata_json or {}).get("host_snapshot") if session else None

    return {
        "operator_goal": operator_goal,
        "server": {
            "id": str(server.id) if server else str(server_id),
            "hostname": server.hostname if server else None,
            "ssh_port": server.ssh_port if server else None,
            "gpu_model": server.gpu_model if server else None,
            "vram_gb": server.vram_gb if server else None,
            "cuda_version": server.cuda_version if server else None,
            "status": server.status.value if server else None,
        },
        "session": {
            "id": str(session.id) if session else None,
            "status": session.status.value if session else None,
            "host_snapshot": snapshot,
        },
        "model": {
            "id": str(model.id) if model else str(model_id),
            "key": model.model_key if model else None,
            "name": model.name if model else None,
            "family": model.family if model else None,
            "params_b": model.param_count_b if model else None,
            "hf_repo": model.hf_repo if model else None,
            "max_context_k": model.max_context_k if model else None,
            "recommended_flags": model.recommended_flags if model else None,
        },
        "quant": {
            "id": str(quant.id) if quant else str(quant_id),
            "name": quant.name if quant else None,
            "hf_repo": quant.hf_repo if quant else None,
            "format": quant.quant_format if quant else None,
            "disk_size_gb": quant.disk_size_gb if quant else None,
            "vram_weights_gb": quant.vram_weights_gb if quant else None,
            "gated": quant.gated if quant else None,
        },
        "platform_recommendation": recommendation.model_dump(mode="json"),
    }


def _context_to_prompt(context: dict[str, Any]) -> str:
    return "Platform deployment context:\n" + json.dumps(context, indent=2, sort_keys=True)


def choose_provider(provider: str, db: Session) -> tuple[str, str, str]:
    requested = provider.lower().strip()
    anthropic_key = get_setting("anthropic_api_key", db)
    openai_key = get_setting("openai_api_key", db)

    if requested in ("auto", ""):
        if anthropic_key:
            return "anthropic", anthropic_key, "claude-haiku-4-5-20251001"
        if openai_key:
            return "openai", openai_key, get_setting("openai_model", db) or "gpt-4.1-mini"
    if requested == "anthropic" and anthropic_key:
        return "anthropic", anthropic_key, "claude-haiku-4-5-20251001"
    if requested in ("openai", "chatgpt") and openai_key:
        return "openai", openai_key, get_setting("openai_model", db) or "gpt-4.1-mini"

    raise ValueError("No AI provider key is configured for this request")


def generate_deploy_guidance(*, provider: str, api_key: str, model: str, context: dict[str, Any]) -> str:
    user_prompt = _context_to_prompt(context)

    if provider == "anthropic":
        import anthropic

        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=model,
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return "".join(getattr(block, "text", "") for block in message.content).strip()

    if provider == "openai":
        response = httpx.post(
            "https://api.openai.com/v1/responses",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "instructions": SYSTEM_PROMPT,
                "input": user_prompt,
                "max_output_tokens": 4096,
            },
            timeout=90,
        )
        response.raise_for_status()
        data = response.json()
        if isinstance(data.get("output_text"), str):
            return data["output_text"].strip()
        texts: list[str] = []
        for item in data.get("output", []):
            for content in item.get("content", []):
                text = content.get("text")
                if isinstance(text, str):
                    texts.append(text)
        return "\n".join(texts).strip()

    raise ValueError(f"Unsupported AI provider: {provider}")
