"""Pure parsing and build helpers for the HF seeder — no I/O, no DB."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.services.hf_constants import (
    GGUF_BPW,
    GGUF_VARIANT_RE,
    _FMT_QUALITY,
    _GGUF_BPW_QUALITY,
    _TORCH_DTYPE_MAP,
    classify_author,
)


# ── Card / metadata parsers ────────────────────────────────────────────────────

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


# ── Capability / architecture detectors ───────────────────────────────────────

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


def _normalize_config(config: dict[str, Any] | None) -> dict[str, Any]:
    """Flatten nested text_config (multimodal models like Gemma 4, Qwen VL) into top level.

    Multimodal models store language model parameters under a 'text_config' sub-dict.
    Top-level keys take precedence over text_config keys to avoid clobbering global settings.
    """
    if not config:
        return {}
    text_cfg: dict[str, Any] = config.get("text_config") or {}
    if not text_cfg:
        return config
    return {**text_cfg, **config}


def _build_kv_cache(config: dict[str, Any] | None) -> dict[str, Any]:
    if not config:
        return {}
    cfg = _normalize_config(config)
    num_heads = cfg.get("num_attention_heads")
    hidden = cfg.get("hidden_size")
    head_dim = cfg.get("head_dim")
    if not head_dim and hidden and num_heads:
        head_dim = hidden // num_heads
    raw_dtype = cfg.get("torch_dtype") or cfg.get("dtype") or ""
    kv_dtype = _TORCH_DTYPE_MAP.get(str(raw_dtype).lower(), "fp16")
    return {
        "num_layers": cfg.get("num_hidden_layers"),
        "num_kv_heads": cfg.get("num_key_value_heads") or num_heads,
        "head_dim": head_dim,
        "kv_dtype_default": kv_dtype,
    }


# ── Quant format detection ─────────────────────────────────────────────────────

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


# ── GGUF file helpers ──────────────────────────────────────────────────────────

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


# ── VRAM / CC / engine support ────────────────────────────────────────────────

def _vram_weights(param_b: float | None, bpw: float | None) -> float | None:
    if not param_b or not bpw:
        return None
    return round(param_b * bpw / 8 * 1.10, 2)


def _cc_min_for(fmt: str) -> str | None:
    return {
        "fp16": "6.1", "bf16": "8.0", "int8": "6.1", "int4": "7.5",
        "gptq": "7.5", "awq": "7.5", "bnb": "7.5",
        "fp8": "8.9", "fp4": "10.0",
    }.get(fmt)


def _vllm_supports(fmt: str) -> bool:
    return fmt in {"fp16", "awq", "gptq", "fp8", "int8", "int4", "bnb", "fp4"}


def _sglang_supports(fmt: str) -> bool:
    return fmt in {"fp16", "awq", "gptq", "fp8", "int8"}


def _quality_score_for(fmt: str, bpw: float | None) -> float:
    if fmt == "gguf" and bpw:
        closest = min(_GGUF_BPW_QUALITY, key=lambda k: abs(k - bpw))
        return _GGUF_BPW_QUALITY[closest]
    return _FMT_QUALITY.get(fmt, 0.5)


# ── Field dict builders ────────────────────────────────────────────────────────

def _derive_recommended_engines(quants: list[Any], param_count_b: float) -> list[dict[str, Any]]:
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
    cfg_raw = config_json or cfg_api or {}
    cfg = _normalize_config(cfg_raw)

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
        "kv_cache": _build_kv_cache(cfg_raw),
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

        # Fall back to gguf.total (sum of all gguf files) when siblings carry no sizes.
        # Distribute proportionally by BPW across variants; unknown-BPW variants get an equal share.
        gguf_total_bytes: int = (gguf.get("total") or 0) if gguf else 0

        variants = _aggregate_gguf_by_variant(files)
        variant_bpws = [GGUF_BPW.get(e["variant"]) if e["variant"] else None for e in variants]
        bpw_sum = sum(b for b in variant_bpws if b) or 1.0
        n_no_bpw = sum(1 for b in variant_bpws if not b) or 1

        rows = []
        for v_entry, v_bpw in zip(variants, variant_bpws):
            v = v_entry["variant"]
            file_bpw = v_bpw
            if v_entry["total_size"]:
                disk_gb = round(v_entry["total_size"] / 1e9, 3)
            elif gguf_total_bytes:
                share = (file_bpw / bpw_sum) if file_bpw else (1.0 / n_no_bpw)
                disk_gb = round(gguf_total_bytes * share / 1e9, 3)
            elif file_bpw and param_count_b:
                # Estimate: GGUF file ≈ bpw/8 × params × 1.05 (slight overhead vs VRAM)
                disk_gb = round(param_count_b * file_bpw / 8 * 1.05, 2)
            else:
                disk_gb = 0.0
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
    # Prefer sibling-based sizes; fall back to safetensors.total from API when siblings carry no sizes
    safe_total_bytes: int = (safe.get("total") or 0) if safe else 0
    disk_gb = (
        _disk_size_from_siblings(siblings)
        or (round(safe_total_bytes / 1e9, 3) if safe_total_bytes else None)
        or 0.0
    )
    return [{
        **base,
        "name": name_pretty,
        "bits_per_weight": bpw or 0.0,
        "disk_size_gb": disk_gb,
        "vram_weights_gb": _vram_weights(param_count_b, bpw) or 0.0,
        "safetensors_dtypes": safe_dtypes,
        "notes": None,
    }]
