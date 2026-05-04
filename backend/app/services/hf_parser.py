"""HuggingFace model page parser.

Given an HF URL or repo_id, fetches:
  - https://huggingface.co/api/models/{repo_id}   → metadata, siblings
  - https://huggingface.co/{repo_id}/raw/main/config.json → architecture

Returns a dict that can be used to pre-fill ModelCreate fields.
Each field is tagged with a confidence level: "high" | "medium" | "low" | "missing".
"""

import logging
import re

import httpx

logger = logging.getLogger(__name__)

HF_API = "https://huggingface.co/api/models"
HF_RAW = "https://huggingface.co"
TIMEOUT = 10.0


def _repo_from_url(hf_url: str) -> str:
    """Extract org/model-name from an HF URL or return the string unchanged."""
    url = hf_url.strip().rstrip("/")
    m = re.search(r"huggingface\.co/([^/?#]+/[^/?#]+)", url)
    if m:
        return m.group(1)
    return url


def parse_hf_model(hf_url: str) -> dict:
    """Fetch HF metadata + config.json and return (suggested_fields, confidence)."""
    repo_id = _repo_from_url(hf_url)
    suggested: dict = {
        "model_key": repo_id.lower().replace("/", "-").replace("_", "-"),
        "hf_url": f"https://huggingface.co/{repo_id}",
        "hf_repo": repo_id,
        "tags": [],
        "recommended_engines": [],
        "recommended_flags": {},
        "kv_cache": {},
        "quants": [],
    }
    confidence: dict[str, str] = {}

    with httpx.Client(timeout=TIMEOUT) as client:
        # ── 1. HF API metadata ────────────────────────────────────────────
        meta: dict = {}
        try:
            r = client.get(f"{HF_API}/{repo_id}")
            if r.status_code == 200:
                meta = r.json()
        except Exception:
            logger.warning("hf_parser: failed to fetch HF API for %s", repo_id)

        if meta:
            author = meta.get("author", "")
            model_id = meta.get("modelId", repo_id)
            display = model_id.split("/")[-1].replace("-", " ").replace("_", " ")
            suggested["name"] = display
            confidence["name"] = "medium"

            # family from author org
            suggested["family"] = author or repo_id.split("/")[0]
            confidence["family"] = "medium"

            # tags → our tag vocabulary
            TAG_MAP = {
                "text-generation": "chat",
                "conversational": "chat",
                "code-generation": "code",
                "text2text-generation": "chat",
            }
            pipeline_tag = meta.get("pipeline_tag", "")
            use_case = TAG_MAP.get(pipeline_tag, "chat")
            suggested["use_case"] = use_case
            confidence["use_case"] = "medium"

            raw_tags: list[str] = meta.get("tags", [])
            our_tags = []
            if any(t in raw_tags for t in ["code", "code-generation", "coding"]):
                our_tags.append("code")
                suggested["is_code_model"] = True
            if any(t in raw_tags for t in ["reasoning", "thinking", "cot"]):
                our_tags.append("reasoning")
                suggested["is_reasoning"] = True
            if any(t in raw_tags for t in ["function-calling", "tool-calling", "tools"]):
                our_tags.append("tool-calling")
                suggested["supports_tools"] = True
            if any(t in raw_tags for t in ["conversational", "chat", "instruct"]):
                if "chat" not in our_tags:
                    our_tags.append("chat")
            if any(t in raw_tags for t in ["moe", "mixture-of-experts"]):
                our_tags.append("moe")
                suggested["is_moe"] = True
            suggested["tags"] = our_tags or ["chat"]
            confidence["tags"] = "medium"

            # param count from safetensors metadata
            card_data = meta.get("cardData", {}) or {}
            base_params = card_data.get("base_model_param_count") or card_data.get("model_parameter_count")
            if base_params:
                try:
                    suggested["param_count_b"] = float(base_params) / 1e9
                    confidence["param_count_b"] = "high"
                except (ValueError, TypeError):
                    pass
            if "param_count_b" not in suggested:
                # try to infer from model name
                m_params = re.search(r"(\d+\.?\d*)b", repo_id.lower())
                if m_params:
                    suggested["param_count_b"] = float(m_params.group(1))
                    confidence["param_count_b"] = "low"

        # ── 2. config.json ────────────────────────────────────────────────
        cfg: dict = {}
        for branch in ("main", "master"):
            try:
                r = client.get(f"{HF_RAW}/{repo_id}/raw/{branch}/config.json")
                if r.status_code == 200:
                    cfg = r.json()
                    break
            except Exception:
                pass

        if cfg:
            num_layers = cfg.get("num_hidden_layers")
            num_heads = cfg.get("num_attention_heads")
            num_kv_heads = cfg.get("num_key_value_heads") or num_heads
            hidden_size = cfg.get("hidden_size")
            head_dim = cfg.get("head_dim")
            if not head_dim and hidden_size and num_heads:
                try:
                    head_dim = hidden_size // num_heads
                except (TypeError, ZeroDivisionError):
                    pass

            max_pos = cfg.get("max_position_embeddings")
            if max_pos:
                suggested["max_context_k"] = max(1, max_pos // 1024)
                confidence["max_context_k"] = "high"

            if num_heads:
                suggested["num_attention_heads"] = int(num_heads)
                confidence["num_attention_heads"] = "high"

            torch_dtype = cfg.get("torch_dtype", "float16")
            kv_dtype = "bf16" if torch_dtype in ("bfloat16", "bf16") else "fp16"

            if num_layers and num_kv_heads and head_dim:
                suggested["kv_cache"] = {
                    "num_layers": int(num_layers),
                    "num_kv_heads": int(num_kv_heads),
                    "head_dim": int(head_dim),
                    "kv_dtype_default": kv_dtype,
                }
                confidence["kv_cache"] = "high"

            # TP allowed sizes from num_heads
            if num_heads:
                tp_sizes = [n for n in [1, 2, 4, 8] if int(num_heads) % n == 0]
                suggested["tp_allowed_sizes"] = tp_sizes
                confidence["tp_allowed_sizes"] = "medium"

        # ── 3. Defaults for anything still missing ────────────────────────
        for field, default, conf in [
            ("name", repo_id.split("/")[-1], "low"),
            ("family", repo_id.split("/")[0], "low"),
            ("param_count_b", 7.0, "missing"),
            ("max_context_k", 8, "missing"),
            ("use_case", "chat", "low"),
        ]:
            if field not in suggested or suggested.get(field) is None:
                suggested[field] = default
                confidence[field] = conf

        # Suggested vLLM engine with placeholder min_vram
        vram_guess = suggested.get("param_count_b", 7.0) * 2  # rough FP16 estimate
        suggested["recommended_engines"] = [
            {"engine": "vllm", "score": 0.9, "min_vram_gb": int(vram_guess)},
            {"engine": "ollama", "score": 0.75, "min_vram_gb": int(vram_guess)},
        ]
        confidence["recommended_engines"] = "low"

    return {"suggested": suggested, "confidence": confidence, "raw_hf_repo": repo_id}
