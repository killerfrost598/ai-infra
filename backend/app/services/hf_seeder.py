"""HuggingFace model seeder — fetches base model + community quants and upserts to DB.

Entry point:
    seed_one_repo(repo_id, *, db, max_quants=None) -> Model

Differences from hf_seed.py:
- Redis cache (24h TTL, prefix hfseed:) replaces filesystem cache
- HF token read from platform_settings key 'hf_token', falls back to HF_TOKEN env var
- Upserts: creates or fully updates the Model row; replaces all existing quants on re-seed
- Deduplicates quant names across multiple community repos (keeps highest-download variant)
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any

import httpx
from huggingface_hub import HfApi
from huggingface_hub.errors import HfHubHTTPError, RepositoryNotFoundError
from sqlalchemy.orm import Session

from app.models.entities import Model, ModelQuant
from app.services.settings_service import get_setting

logger = logging.getLogger(__name__)

_CACHE_TTL = 24 * 3600
_USER_AGENT = "ai-infra-seeder/0.2 (+local)"

# ── Author classification ──────────────────────────────────────────────────────

STANDARD_AUTHORS: dict[str, str] = {
    "meta-llama": "Meta", "facebook": "Meta",
    "google": "Google", "google-research": "Google",
    "google-deepmind": "Google DeepMind", "deepmind": "Google DeepMind",
    "microsoft": "Microsoft", "nvidia": "NVIDIA",
    "deepseek-ai": "DeepSeek",
    "qwen": "Alibaba (Qwen)", "alibaba-nlp": "Alibaba",
    "mistralai": "Mistral AI", "mistral-community": "Mistral AI",
    "apple": "Apple", "ibm": "IBM", "ibm-granite": "IBM",
    "cohereforai": "Cohere", "coherelabs": "Cohere",
    "01-ai": "01.AI", "databricks": "Databricks",
    "xai-org": "xAI", "tiiuae": "TII (Falcon)",
    "allenai": "Allen AI", "openai": "OpenAI",
    "stabilityai": "Stability AI", "bigcode": "BigCode",
    "bigscience": "BigScience",
    "huggingfaceh4": "Hugging Face H4", "huggingfacetb": "Hugging Face",
    "ai21labs": "AI21", "snowflake": "Snowflake",
    "internlm": "InternLM", "thudm": "THUDM (Zhipu)",
    "zai-org": "Zhipu AI", "baichuan-inc": "Baichuan",
    "moonshotai": "Moonshot AI", "minimax-ai": "MiniMax",
    "rakutengroup": "Rakuten", "amazon": "Amazon",
    "salesforce": "Salesforce", "intel": "Intel", "amd": "AMD",
    "perplexity-ai": "Perplexity", "kyutai": "Kyutai",
    "nousresearch": "Nous Research", "togethercomputer": "Together AI",
    "upstage": "Upstage",
}

KNOWN_COMMUNITY_AUTHORS: dict[str, str] = {
    "unsloth": "Unsloth", "mlx-community": "MLX Community",
    "thebloke": "TheBloke", "bartowski": "bartowski",
    "lmstudio-community": "LM Studio Community", "lmstudio-ai": "LM Studio",
    "maziyarpanahi": "MaziyarPanahi", "quantfactory": "QuantFactory",
    "legraphista": "legraphista",
    "nm-testing": "Neural Magic", "neuralmagic": "Neural Magic",
    "redhatai": "Red Hat AI", "cortexso": "Cortex",
    "modelcloud": "ModelCloud", "ggml-org": "ggml.org",
    "ggerganov": "ggerganov", "casperhansen": "casperhansen",
    "second-state": "Second State", "tensorblock": "TensorBlock",
    "qwen-mlx": "Qwen-MLX", "ikawrakow": "ikawrakow",
    "mradermacher": "mradermacher", "city96": "city96",
    "hugging-quants": "Hugging Quants", "intel-optimized": "Intel Optimized",
}


def classify_author(repo_id: str) -> tuple[str, str, str]:
    """Return (author, author_class, author_label). author_class: standard | community | private."""
    if "/" not in repo_id:
        return repo_id, "private", repo_id
    author = repo_id.split("/", 1)[0]
    key = author.lower()
    if key in STANDARD_AUTHORS:
        return author, "standard", STANDARD_AUTHORS[key]
    if key in KNOWN_COMMUNITY_AUTHORS:
        return author, "community", KNOWN_COMMUNITY_AUTHORS[key]
    return author, "private", author


# ── GGUF constants ─────────────────────────────────────────────────────────────

GGUF_VARIANT_RE = re.compile(
    r"(?P<v>(?:IQ|Q)[0-9]+(?:_[A-Z0-9]+)*|FP16|FP32|F16|F32|BF16)"
    r"(?:[-_]\d+[-_]of[-_]\d+)?\.gguf$",
    re.IGNORECASE,
)

GGUF_BPW: dict[str, float] = {
    "Q2_K": 3.0, "Q2_K_S": 2.7,
    "Q3_K_S": 3.5, "Q3_K_M": 3.9, "Q3_K_L": 4.3,
    "Q4_0": 4.5, "Q4_1": 4.8, "Q4_K_S": 4.6, "Q4_K_M": 4.85,
    "Q5_0": 5.5, "Q5_1": 5.9, "Q5_K_S": 5.5, "Q5_K_M": 5.7,
    "Q6_K": 6.6, "Q8_0": 8.5, "Q8_K": 8.5,
    "IQ1_S": 1.6, "IQ1_M": 1.8,
    "IQ2_XXS": 2.1, "IQ2_XS": 2.3, "IQ2_S": 2.5, "IQ2_M": 2.7,
    "IQ3_XXS": 3.1, "IQ3_XS": 3.2, "IQ3_S": 3.4, "IQ3_M": 3.6,
    "IQ4_XS": 4.3, "IQ4_NL": 4.5,
    "F16": 16.0, "FP16": 16.0, "BF16": 16.0, "F32": 32.0, "FP32": 32.0,
}

_MODEL_EXPAND = [
    "config", "cardData", "siblings", "tags", "safetensors", "gguf",
    "gated", "downloads", "likes", "library_name", "pipeline_tag",
    "lastModified", "createdAt", "trendingScore", "private", "disabled",
]

_QUANT_LIST_EXPAND = [
    "tags", "safetensors", "gguf", "gated", "downloads", "likes",
    "library_name", "pipeline_tag", "lastModified", "siblings",
]

# ── Redis cache ────────────────────────────────────────────────────────────────

def _get_redis():
    import redis as _redis
    return _redis.from_url("redis://redis:6379/2", decode_responses=True, socket_connect_timeout=2)


def _cache_get(kind: str, key: str) -> Any | None:
    cache_key = f"hfseed:{kind}:{key.replace('/', '__')}"
    try:
        val = _get_redis().get(cache_key)
        return json.loads(val) if val is not None else None
    except Exception:
        return None


def _cache_put(kind: str, key: str, value: Any) -> None:
    cache_key = f"hfseed:{kind}:{key.replace('/', '__')}"
    try:
        _get_redis().setex(cache_key, _CACHE_TTL, json.dumps(value, default=str))
    except Exception:
        pass


# ── HF token + API ────────────────────────────────────────────────────────────

def _get_token(db: Session) -> str | None:
    token = get_setting("hf_token", db)
    if not token:
        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    return token or None


def _make_api(token: str | None) -> HfApi:
    return HfApi(token=token, user_agent=_USER_AGENT)


# ── HF fetch helpers ──────────────────────────────────────────────────────────

def _fetch_model_info(api: HfApi, repo_id: str) -> dict[str, Any] | None:
    cached = _cache_get("modelinfo", repo_id)
    if cached is not None:
        return None if cached.get("_error") else cached

    try:
        info = api.model_info(repo_id, expand=_MODEL_EXPAND)
    except RepositoryNotFoundError:
        _cache_put("modelinfo", repo_id, {"_error": "not_found"})
        return None
    except HfHubHTTPError as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        _cache_put("modelinfo", repo_id, {"_error": f"http_{status}"})
        return None

    sib = [
        {"rfilename": getattr(s, "rfilename", None), "size": getattr(s, "size", None)}
        for s in (getattr(info, "siblings", None) or [])
    ]
    safe_raw = getattr(info, "safetensors", None)
    safe_d = (
        {"parameters": getattr(safe_raw, "parameters", None) or {}, "total": getattr(safe_raw, "total", None)}
        if safe_raw is not None else None
    )
    gguf_raw = getattr(info, "gguf", None)

    out: dict[str, Any] = {
        "id": info.id,
        "config": getattr(info, "config", None),
        "cardData": (info.card_data.to_dict() if getattr(info, "card_data", None) else None),
        "siblings": sib,
        "tags": list(getattr(info, "tags", []) or []),
        "safetensors": safe_d,
        "gguf": {"total": getattr(gguf_raw, "total", None)} if gguf_raw is not None else None,
        "gated": getattr(info, "gated", None),
        "downloads": getattr(info, "downloads", None),
        "likes": getattr(info, "likes", None),
        "library_name": getattr(info, "library_name", None),
        "pipeline_tag": getattr(info, "pipeline_tag", None),
        "lastModified": str(getattr(info, "last_modified", None)),
        "createdAt": str(getattr(info, "created_at", None)),
        "trendingScore": getattr(info, "trending_score", None),
    }
    _cache_put("modelinfo", repo_id, out)
    return out


def _fetch_config_json(repo_id: str, token: str | None) -> dict[str, Any] | None:
    cached = _cache_get("config", repo_id)
    if cached is not None:
        return None if cached.get("_missing") else cached

    headers = {"User-Agent": _USER_AGENT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    url = f"https://huggingface.co/{repo_id}/resolve/main/config.json"
    try:
        r = httpx.get(url, headers=headers, timeout=20, follow_redirects=True)
    except httpx.RequestError:
        _cache_put("config", repo_id, {"_missing": True})
        return None

    if r.status_code == 200:
        try:
            data = r.json()
            _cache_put("config", repo_id, data)
            return data
        except Exception:
            pass

    _cache_put("config", repo_id, {"_missing": True})
    return None


def _list_quants(api: HfApi, repo_id: str, max_quants: int | None) -> list[dict[str, Any]]:
    cached = _cache_get("quants", repo_id)
    if cached is not None:
        return cached if max_quants is None else cached[:max_quants]

    rows: list[dict[str, Any]] = []
    try:
        for m in api.list_models(
            filter=f"base_model:quantized:{repo_id}",
            sort="downloads",
            limit=max_quants or 1000,
            expand=_QUANT_LIST_EXPAND,
        ):
            sib = [
                {"rfilename": getattr(s, "rfilename", None), "size": getattr(s, "size", None)}
                for s in (getattr(m, "siblings", None) or [])
            ]
            safe_raw = getattr(m, "safetensors", None)
            safe_d = (
                {"parameters": getattr(safe_raw, "parameters", None) or {}, "total": getattr(safe_raw, "total", None)}
                if safe_raw is not None else None
            )
            gguf_raw = getattr(m, "gguf", None)
            rows.append({
                "id": m.id,
                "tags": list(getattr(m, "tags", []) or []),
                "downloads": getattr(m, "downloads", None),
                "likes": getattr(m, "likes", None),
                "library_name": getattr(m, "library_name", None),
                "pipeline_tag": getattr(m, "pipeline_tag", None),
                "gated": getattr(m, "gated", None),
                "siblings": sib,
                "safetensors": safe_d,
                "gguf": {"total": getattr(gguf_raw, "total", None)} if gguf_raw is not None else None,
            })
    except HfHubHTTPError:
        pass

    _cache_put("quants", repo_id, rows)
    return rows if max_quants is None else rows[:max_quants]


# ── Pure parsing helpers ──────────────────────────────────────────────────────

def _parse_languages(card: dict[str, Any] | None) -> list[str] | None:
    if not card:
        return None
    lang = card.get("language")
    if isinstance(lang, str):
        return [lang]
    if isinstance(lang, list):
        return [str(x) for x in lang]
    return None


def _parse_license(card: dict[str, Any] | None) -> str | None:
    if not card:
        return None
    lic = card.get("license")
    if isinstance(lic, str):
        return lic
    if isinstance(lic, list) and lic:
        return str(lic[0])
    return None


def _parse_base_model(card: dict[str, Any] | None) -> str | None:
    if not card:
        return None
    bm = card.get("base_model")
    if isinstance(bm, str):
        return bm
    if isinstance(bm, list) and bm:
        return str(bm[0])
    return None


def _parse_datetime(s: str | None) -> datetime | None:
    if not s or s == "None":
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _gated_str(raw: Any) -> str | None:
    if not raw:
        return None
    return raw if isinstance(raw, str) else "true"


def _detect_capabilities(tags: list[str], name: str) -> dict[str, bool]:
    tl = [t.lower() for t in tags]
    nl = name.lower()
    return {
        "is_reasoning": (
            any(k in nl for k in ["r1", "qwq", "reasoning", "o1"]) or "reasoning" in tl
        ),
        "supports_tools": any(k in tl for k in ["tool-use", "function-calling", "tool_use"]),
        "is_code_model": any(k in nl for k in ["coder", "code-"]) or "code" in tl,
    }


def _detect_moe(config: dict[str, Any] | None) -> tuple[bool, float | None]:
    if not config:
        return False, None
    is_moe = any(k in config for k in ("num_experts", "num_local_experts", "n_routed_experts"))
    return is_moe, None


def _compute_tp_sizes(num_heads: int | None, num_kv: int | None) -> list[int] | None:
    if not num_heads:
        return None
    divs = {d for d in (1, 2, 4, 8) if num_heads % d == 0}
    if num_kv:
        divs &= {d for d in (1, 2, 4, 8) if num_kv % d == 0}
    return sorted(divs) or None


_TORCH_DTYPE_MAP: dict[str, str] = {
    "bfloat16": "bf16",
    "float16": "fp16",
    "float32": "fp16",   # treat fp32 as fp16 for KV cache purposes
    "float8_e4m3fn": "fp8",
    "float8_e5m2": "fp8",
    "fp16": "fp16",
    "bf16": "bf16",
    "fp8": "fp8",
}


def _build_kv_cache(config: dict[str, Any] | None) -> dict[str, Any]:
    if not config:
        return {}
    num_heads = config.get("num_attention_heads")
    hidden = config.get("hidden_size")
    head_dim = config.get("head_dim")
    if not head_dim and hidden and num_heads:
        head_dim = hidden // num_heads
    raw_dtype = config.get("torch_dtype") or ""
    kv_dtype = _TORCH_DTYPE_MAP.get(str(raw_dtype).lower(), "fp16")
    return {
        "num_layers": config.get("num_hidden_layers"),
        "num_kv_heads": config.get("num_key_value_heads") or num_heads,
        "head_dim": head_dim,
        "kv_dtype_default": kv_dtype,
    }


def _detect_quant_format(
    tags: list[str],
    safetensors: dict[str, Any] | None,
    gguf: dict[str, Any] | None,
    repo_id: str,
    library_name: str | None = None,
) -> tuple[str, str | None, float | None]:
    tl = [t.lower() for t in tags]
    rl = repo_id.lower()
    lib = (library_name or "").lower()

    if lib == "mlx" or "mlx" in tl or rl.startswith("mlx-community/"):
        for v, b in (("8bit", 8.0), ("6bit", 6.0), ("5bit", 5.0), ("4bit", 4.5), ("3bit", 3.5), ("2bit", 2.5)):
            if rl.endswith(f"-{v}") or f"-{v}-" in rl:
                return "mlx", v, b
        return "mlx", None, None
    if gguf or "gguf" in tl or rl.endswith("-gguf") or "-gguf" in rl:
        return "gguf", None, None
    if "mxfp4" in tl or "-mxfp4" in rl:
        return "fp4", "mxfp4", 4.0
    if "awq" in tl or "-awq" in rl:
        return "awq", "4bit", 4.5
    if "gptq" in tl or "-gptq" in rl:
        return "gptq", "4bit", 4.5
    if "bitsandbytes" in tl or "bnb" in tl or "nf4" in tl or "-bnb" in rl or "-nf4" in rl:
        return "bnb", "nf4", 4.5
    if "fp8" in tl or "-fp8" in rl or "w8a8-fp8" in tl:
        return "fp8", None, 8.0
    if "int8" in tl or "w8a8" in tl or "-int8" in rl or rl.endswith("-8bit"):
        return "int8", None, 8.0
    if "int4" in tl or "w4a16" in tl or "-int4" in rl or rl.endswith("-4bit"):
        return "int4", None, 4.5
    if safetensors and safetensors.get("parameters"):
        keys = list(safetensors["parameters"].keys())
        for k in ("F8_E4M3", "F8_E5M2"):
            if k in keys:
                return "fp8", k, 8.0
        if "I8" in keys:
            return "int8", "I8", 8.0
        if "I4" in keys:
            return "int4", "I4", 4.5
        if "BF16" in keys or "F16" in keys:
            return "fp16", None, 16.0
    return "unknown", None, None


def _gguf_files_in_siblings(siblings: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not siblings:
        return []
    out = []
    for s in siblings:
        n = s.get("rfilename") or ""
        if not n.lower().endswith(".gguf"):
            continue
        m = GGUF_VARIANT_RE.search(n)
        out.append({"name": n, "size": s.get("size"), "variant": m.group("v").upper() if m else None})
    return out


def _aggregate_gguf_by_variant(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_variant: dict[str | None, dict[str, Any]] = {}
    for f in files:
        v = f.get("variant")
        entry = by_variant.setdefault(v, {"variant": v, "files": [], "total_size": 0})
        entry["files"].append(f["name"])
        if f.get("size"):
            entry["total_size"] += f["size"]
    out = [
        {
            "variant": v,
            "file_count": len(e["files"]),
            "first_file": e["files"][0] if e["files"] else None,
            "total_size": e["total_size"] or None,
        }
        for v, e in by_variant.items()
    ]
    out.sort(key=lambda x: (x["variant"] is None, -(x["total_size"] or 0)))
    return out


def _disk_size_from_siblings(siblings: list[dict[str, Any]] | None) -> float | None:
    if not siblings:
        return None
    total = sum(
        (s.get("size") or 0)
        for s in siblings
        if (s.get("rfilename") or "").lower().endswith((".safetensors", ".bin", ".gguf", ".pt", ".pth"))
    )
    return round(total / 1e9, 3) if total else None


def _vram_weights(param_b: float | None, bpw: float | None) -> float | None:
    if not param_b or not bpw:
        return None
    return round(param_b * bpw / 8 * 1.10, 2)


def _cc_min_for(fmt: str) -> str | None:
    return {
        "fp16": "6.1", "int8": "6.1", "int4": "7.5",
        "gptq": "7.5", "awq": "7.5", "bnb": "7.5",
        "fp8": "8.9", "fp4": "10.0",
    }.get(fmt)


def _vllm_supports(fmt: str) -> bool:
    return fmt in {"fp16", "awq", "gptq", "fp8", "int8", "int4", "bnb", "fp4"}


def _sglang_supports(fmt: str) -> bool:
    return fmt in {"fp16", "awq", "gptq", "fp8", "int8"}


# Maps GGUF bpw → quality score (higher bpw = better quality)
_GGUF_BPW_QUALITY: dict[float, float] = {
    2.0: 0.20, 2.5: 0.25, 3.0: 0.32, 3.5: 0.38,
    4.0: 0.48, 4.5: 0.55, 5.0: 0.63, 5.5: 0.68,
    6.0: 0.75, 6.5: 0.78, 7.0: 0.82, 8.0: 0.88,
}

_FMT_QUALITY: dict[str, float] = {
    "fp16": 1.00, "bf16": 1.00,
    "fp8": 0.90,
    "int8": 0.80,
    "awq": 0.72, "gptq": 0.70,
    "int4": 0.60, "fp4": 0.55,
    "bnb": 0.50,
    "mlx": 0.65,
    "gguf": 0.55,   # fallback when bpw unknown
}


def _quality_score_for(fmt: str, bpw: float | None) -> float:
    if fmt == "gguf" and bpw:
        # find closest key
        closest = min(_GGUF_BPW_QUALITY, key=lambda k: abs(k - bpw))
        return _GGUF_BPW_QUALITY[closest]
    return _FMT_QUALITY.get(fmt, 0.5)


def _derive_recommended_engines(quants: list[Any], param_count_b: float) -> list[dict[str, Any]]:
    """Derive model-level engine recommendations from seeded quant data."""
    has_vllm   = any(getattr(q, "arch_vllm", False)   for q in quants)
    has_sglang = any(getattr(q, "arch_sglang", False)  for q in quants)
    has_gguf   = any(getattr(q, "quant_format", "") == "gguf" for q in quants)

    vrams = [q.vram_weights_gb for q in quants if getattr(q, "vram_weights_gb", 0) > 0]
    min_vram = min(vrams) if vrams else round(param_count_b * 2 / 8, 1)

    engines: list[dict[str, Any]] = []
    if has_vllm:
        engines.append({"engine": "vllm",   "score": 0.90, "min_vram_gb": min_vram})
    if has_sglang:
        engines.append({"engine": "sglang", "score": 0.85, "min_vram_gb": min_vram})
    if has_gguf:
        engines.append({"engine": "ollama", "score": 0.70, "min_vram_gb": min_vram})

    if not engines:
        engines = [
            {"engine": "vllm",   "score": 0.80, "min_vram_gb": min_vram},
            {"engine": "sglang", "score": 0.75, "min_vram_gb": min_vram},
            {"engine": "ollama", "score": 0.60, "min_vram_gb": min_vram},
        ]
    return engines


# ── Build field dicts ─────────────────────────────────────────────────────────

def _build_model_fields(
    info: dict[str, Any],
    config_json: dict[str, Any] | None,
    org: str,
) -> dict[str, Any]:
    repo_id: str = info["id"]
    tags: list[str] = info.get("tags") or []
    card: dict[str, Any] = info.get("cardData") or {}
    safe: dict[str, Any] = info.get("safetensors") or {}
    cfg_api: dict[str, Any] = info.get("config") or {}
    cfg = config_json or cfg_api or {}

    name = repo_id.split("/", 1)[1]

    total_params = (safe.get("total") if safe else None) or 0
    param_count_b: float = round(total_params / 1e9, 3) if total_params else 0.0
    if not param_count_b:
        for k in ("num_parameters", "n_parameters"):
            if k in cfg:
                param_count_b = round(cfg[k] / 1e9, 3)
                break

    architecture = None
    archs = cfg_api.get("architectures") or cfg.get("architectures")
    if isinstance(archs, list) and archs:
        architecture = archs[0]

    max_ctx = cfg.get("max_position_embeddings")
    max_ctx_k = round(max_ctx / 1024) if max_ctx else 0

    caps = _detect_capabilities(tags, name)
    is_moe, moe_active = _detect_moe(cfg)
    author, author_class, author_label = classify_author(repo_id)

    return {
        "model_key": repo_id,
        "name": name,
        "family": org,
        "org": org,
        "author": author,
        "author_class": author_class,
        "author_label": author_label,
        "author_url": f"https://huggingface.co/{author}",
        "param_count_b": param_count_b,
        "architecture": architecture,
        "pipeline_tag": info.get("pipeline_tag"),
        "library_name": info.get("library_name"),
        "license": _parse_license(card),
        "languages": _parse_languages(card),
        "hf_url": f"https://huggingface.co/{repo_id}",
        "hf_repo": repo_id,
        "max_context_k": max_ctx_k,
        "tags": tags,
        "is_reasoning": caps["is_reasoning"],
        "supports_tools": caps["supports_tools"],
        "is_code_model": caps["is_code_model"],
        "is_moe": is_moe,
        "moe_active_params_b": moe_active,
        "num_attention_heads": cfg.get("num_attention_heads"),
        "tp_allowed_sizes": _compute_tp_sizes(
            cfg.get("num_attention_heads"), cfg.get("num_key_value_heads")
        ),
        "kv_cache": _build_kv_cache(cfg),
        "gated": _gated_str(info.get("gated")),
        "base_model": _parse_base_model(card),
        "hf_downloads": info.get("downloads"),
        "hf_likes": info.get("likes"),
        "hf_trending_score": info.get("trendingScore"),
        "hf_last_modified": _parse_datetime(info.get("lastModified")),
        "hf_created_at": _parse_datetime(info.get("createdAt")),
        "source": "hf",
        "hf_synced_at": datetime.now(timezone.utc),
    }


def _build_quant_dicts(
    param_count_b: float,
    quant_info: dict[str, Any],
) -> list[dict[str, Any]]:
    repo_id: str = quant_info["id"]
    tags: list[str] = quant_info.get("tags") or []
    safe: dict[str, Any] = quant_info.get("safetensors") or {}
    gguf: dict[str, Any] = quant_info.get("gguf") or {}
    siblings: list[dict[str, Any]] = quant_info.get("siblings") or []

    fmt, variant, bpw = _detect_quant_format(tags, safe, gguf, repo_id, quant_info.get("library_name"))
    q_author, q_author_class, q_author_label = classify_author(repo_id)

    base: dict[str, Any] = {
        "hf_repo": repo_id,
        "hf_url": f"https://huggingface.co/{repo_id}",
        "author": q_author,
        "author_class": q_author_class,
        "author_label": q_author_label,
        "author_url": f"https://huggingface.co/{q_author}",
        "quant_format": fmt,
        "quant_variant": variant,
        "tags": tags,
        "library_name": quant_info.get("library_name"),
        "gated": _gated_str(quant_info.get("gated")),
        "hf_downloads": quant_info.get("downloads"),
        "hf_likes": quant_info.get("likes"),
        "safetensors_dtypes": None,
        "cc_min": _cc_min_for(fmt),
        "arch_vllm": _vllm_supports(fmt),
        "arch_sglang": _sglang_supports(fmt),
        "quality_score": _quality_score_for(fmt, bpw),
    }

    if fmt == "gguf":
        files = _gguf_files_in_siblings(siblings)
        if not files:
            return [{
                **base,
                "name": "GGUF",
                "quant_variant": None,
                "bits_per_weight": 0.0,
                "disk_size_gb": 0.0,
                "vram_weights_gb": 0.0,
                "cc_min": None,
                "arch_vllm": False,
                "arch_sglang": False,
                "notes": "GGUF repo with no .gguf files surfaced in siblings",
            }]

        rows = []
        for v_entry in _aggregate_gguf_by_variant(files):
            v = v_entry["variant"]
            file_bpw = GGUF_BPW.get(v) if v else None
            disk_gb = round(v_entry["total_size"] / 1e9, 3) if v_entry["total_size"] else 0.0
            n_files = v_entry["file_count"]
            note = (
                f"{n_files} shards · first: {v_entry['first_file']}"
                if n_files > 1
                else v_entry["first_file"]
            )
            rows.append({
                **base,
                "name": f"GGUF-{v}" if v else "GGUF-unknown",
                "quant_variant": v,
                "bits_per_weight": file_bpw or 0.0,
                "disk_size_gb": disk_gb,
                "vram_weights_gb": _vram_weights(param_count_b, file_bpw) or 0.0,
                "cc_min": None,
                "arch_vllm": False,
                "arch_sglang": False,
                "quality_score": _quality_score_for("gguf", file_bpw),
                "notes": note,
            })
        return rows

    name_pretty = {
        "fp16": "FP16", "fp8": "FP8", "int8": "INT8", "int4": "INT4",
        "fp4": "FP4-MXFP4" if variant == "mxfp4" else "FP4",
        "awq": "AWQ-4bit", "gptq": "GPTQ-4bit", "bnb": "BNB-NF4",
        "mlx": f"MLX-{variant}" if variant else "MLX",
        "unknown": "UNKNOWN",
    }.get(fmt, fmt.upper())

    safe_dtypes = (safe.get("parameters") if safe else None) or None
    return [{
        **base,
        "name": name_pretty,
        "bits_per_weight": bpw or 0.0,
        "disk_size_gb": _disk_size_from_siblings(siblings) or 0.0,
        "vram_weights_gb": _vram_weights(param_count_b, bpw) or 0.0,
        "safetensors_dtypes": safe_dtypes,
        "notes": None,
    }]


# ── Public entry point ────────────────────────────────────────────────────────

def seed_one_repo(
    repo_id: str,
    *,
    db: Session,
    max_quants: int | None = None,
) -> Model:
    """Fetch HF metadata for repo_id and upsert into the DB.

    - Creates the Model row when it doesn't exist.
    - Updates all HF-sourced fields on an existing row (source is set to 'hf').
    - Deletes then re-inserts all quants (de-duplicated by name; highest-download wins).
    - Raises ValueError if HF returns an error for the repo.
    """
    token = _get_token(db)
    api = _make_api(token)

    info = _fetch_model_info(api, repo_id)
    if not info:
        raise ValueError(f"Could not fetch HF metadata for {repo_id!r}")

    org = repo_id.split("/", 1)[0] if "/" in repo_id else repo_id
    config_json = _fetch_config_json(repo_id, token)
    model_fields = _build_model_fields(info, config_json, org)
    param_count_b: float = model_fields["param_count_b"]

    model = db.query(Model).filter(Model.model_key == repo_id).first()
    if model is None:
        model = Model(**model_fields)
        db.add(model)
        db.flush()
        logger.info("hf_seeder: created %s", repo_id)
    else:
        for k, v in model_fields.items():
            setattr(model, k, v)
        db.flush()
        logger.info("hf_seeder: updated %s", repo_id)

    # Replace all quants — delete then re-insert
    db.query(ModelQuant).filter(ModelQuant.model_id == model.id).delete(
        synchronize_session=False
    )
    db.flush()

    # Collect and deduplicate by name (quant_repos is downloads-sorted, first = best)
    quant_by_name: dict[str, dict[str, Any]] = {}
    for qr in _list_quants(api, repo_id, max_quants):
        for qdict in _build_quant_dicts(param_count_b, qr):
            name = qdict["name"]
            if name not in quant_by_name:
                quant_by_name[name] = qdict

    for qdict in quant_by_name.values():
        db.add(ModelQuant(model_id=model.id, **qdict))

    db.commit()
    db.refresh(model)

    # Derive recommended_engines from the actual quant data now that they're written
    model.recommended_engines = _derive_recommended_engines(model.quants, param_count_b)
    db.commit()

    logger.info("hf_seeder: %s — %d quants written, engines=%s",
                repo_id, len(model.quants),
                [e["engine"] for e in model.recommended_engines])
    return model
