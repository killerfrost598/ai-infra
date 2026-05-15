"""Allow-list resolver: given a ModelQuant, return exact files + glob patterns to download."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

# Sidecar / config files always fetched regardless of quant format.
_ALWAYS_EXACT: list[str] = [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "tokenizer.model",
    "chat_template.jinja",
    "generation_config.json",
]

# Notes pattern: "3 shards · first: model-Q5_K_M-00001-of-00003.gguf"
_SHARD_RE = re.compile(r"^\d+\s+shards\s+·\s+first:\s+(.+)$")

# Strip shard index suffix to derive pattern prefix
_SHARD_SUFFIX_RE = re.compile(r"-\d+-of-\d+\.gguf$", re.IGNORECASE)

_SAFETENSORS_FORMATS = frozenset({"fp16", "awq", "gptq", "fp8", "int8", "int4", "bnb", "fp4"})
_MLX_FORMATS = frozenset({"mlx"})


@dataclass(frozen=True)
class FileAllow:
    repo_id: str
    files_key: str            # sha1[:16] of stable input tuple
    exact_files: list[str]   # always fetched by exact name
    allow_patterns: list[str]  # fnmatch globs for sidecar pickup

    def __post_init__(self) -> None:
        # frozen dataclass — use object.__setattr__ is not needed since we set these at init
        pass


def _compute_key(repo_id: str, exact_files: list[str], allow_patterns: list[str]) -> str:
    payload = f"{repo_id}|{','.join(sorted(exact_files))}|{','.join(sorted(allow_patterns))}"
    return hashlib.sha1(payload.encode()).hexdigest()[:16]


def resolve_allowlist(quant: object, model: object) -> FileAllow:
    """Build a FileAllow from a ModelQuant + Model pair.

    Raises ValueError if no HF repo_id can be found.
    """
    repo_id: str = (getattr(quant, "hf_repo", None) or "").strip()
    if not repo_id:
        repo_id = (getattr(model, "hf_repo", None) or "").strip()
    if not repo_id:
        raise ValueError("No Hugging Face repo_id found on quant or model")

    exact_files: list[str] = list(_ALWAYS_EXACT)
    allow_patterns: list[str] = []

    quant_format: str = (getattr(quant, "quant_format", None) or "").lower().strip()
    notes: str = (getattr(quant, "notes", None) or "").strip()
    quant_variant: str = (getattr(quant, "quant_variant", None) or "").strip()

    if quant_format == "gguf":
        shard_match = _SHARD_RE.match(notes)
        if shard_match:
            first_file = shard_match.group(1).strip()
            if first_file not in exact_files:
                exact_files.append(first_file)
            # Derive prefix: strip "-NNNNN-of-NNNNN.gguf"
            prefix = _SHARD_SUFFIX_RE.sub("", first_file)
            allow_patterns.append(f"{prefix}-*-of-*.gguf")
        elif notes and not notes.startswith("0 shards"):
            # Plain single-file notes: just a filename
            if notes not in exact_files:
                exact_files.append(notes)
        elif quant_variant:
            # Fallback: use quant_variant glob
            allow_patterns.append(f"*{quant_variant}*.gguf")
        else:
            # Last resort: accept any gguf
            allow_patterns.append("*.gguf")

    elif quant_format in _SAFETENSORS_FORMATS:
        allow_patterns.append("*.safetensors")
        allow_patterns.append("*.safetensors.index.json")

    elif quant_format in _MLX_FORMATS:
        allow_patterns.append("*.npz")
        allow_patterns.append("weights.*.safetensors")
        allow_patterns.append("*.safetensors")

    else:
        # Unknown format: pull safetensors as a safe default
        allow_patterns.append("*.safetensors")
        allow_patterns.append("*.safetensors.index.json")

    files_key = _compute_key(repo_id, exact_files, allow_patterns)
    return FileAllow(
        repo_id=repo_id,
        files_key=files_key,
        exact_files=exact_files,
        allow_patterns=allow_patterns,
    )
