"""Static lookup tables and pure author classification for the HF seeder."""
from __future__ import annotations

import re

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
