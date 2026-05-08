"""GPU name parser — maps raw Clore.ai GPU strings to structured fields.

Alias-first: tries to match against gpu_profiles.json canonical aliases.
Regex fallback: extracts family token when no alias matches.
Graceful: never crashes; unknown GPUs produce is_known=False with a best-effort family.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

_PROFILES_PATH = Path(__file__).parent.parent / "seeds" / "gpu_profiles.json"

# Compound variants must come before single-token variants in the alternation.
_VARIANT_RE = re.compile(
    r"\b(Ti\s+Super|Super\s+Ti|Ti|Super|XTX|XT|Pro|Max|Mobile|Laptop)\b",
    re.IGNORECASE,
)

_COUNT_PREFIX_RE = re.compile(r"^\d+[xX]\s+")

# Vendor detection — NVIDIA first (more specific markers)
_VENDOR_NVIDIA_RE = re.compile(r"\b(nvidia|geforce|gtx|rtx|tesla|quadro)\b", re.IGNORECASE)
_VENDOR_AMD_RE = re.compile(r"\b(amd|radeon|instinct|mi\d+)\b", re.IGNORECASE)
_VENDOR_INTEL_RE = re.compile(r"\b(intel|arc|xe)\b", re.IGNORECASE)

# Strip vendor name prefix from display_name to produce a compact family label.
# "NVIDIA GeForce RTX 3090" → "RTX 3090"; "NVIDIA A100 40GB" → "A100 40GB"
_VENDOR_PREFIX_RE = re.compile(r"^(NVIDIA\s+GeForce\s+|NVIDIA\s+|AMD\s+|Intel\s+)", re.IGNORECASE)

# Strip VRAM quantity suffix so all VRAM capacities of the same model share one family label.
# "A100 40GB" and "A100 80GB" both become "A100" and group together.
_VRAM_SUFFIX_RE = re.compile(r"\s+\d+\s*GB\s*$", re.IGNORECASE)

# Inline noise tokens (not just prefix) to clean from the candidate string
_NOISE_RE = re.compile(r"\b(nvidia|amd|intel|geforce)\b\s*", re.IGNORECASE)

# Regex fallback to extract a GPU family token from unrecognised raw strings
_FAMILY_FALLBACK_RE = re.compile(
    r"\b(?:RTX|GTX|RX)\s*\d{3,4}\w*"
    r"|\bTesla\s+\w+"
    r"|\bRadeon(?:\s+Pro)?\s+\w+"
    r"|\bInstinct\s+\w+"
    r"|\b[ABHLPV]\d{2,3}S?(?:-\w+)?"
    r"|\bMI\d+\w*"
    r"|\bArc\s+[A-Z]\d+",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ParsedGpu:
    vendor: str           # "NVIDIA" | "AMD" | "Intel" | "Unknown"
    family: str           # canonical model, e.g. "RTX 3090", "Tesla T4", "A100"
    variant: str | None   # "Ti" | "Super" | "Ti Super" | None
    raw: str              # original unmodified string
    is_known: bool        # True when matched a gpu_profiles.json alias


@lru_cache(maxsize=1)
def _alias_lookup() -> dict[str, str]:
    """Build lowercase alias → compact family name map from gpu_profiles.json."""
    try:
        profiles = json.loads(_PROFILES_PATH.read_text())
    except Exception:
        return {}
    lookup: dict[str, str] = {}
    for p in profiles:
        display: str = p["display_name"]
        # Strip vendor prefix then VRAM suffix for the compact family label
        compact = _VENDOR_PREFIX_RE.sub("", display).strip()
        compact = _VRAM_SUFFIX_RE.sub("", compact).strip()
        for alias in p.get("aliases", []) + [display]:
            lookup[alias.lower()] = compact
    return lookup


def _detect_vendor(text: str) -> str:
    if _VENDOR_NVIDIA_RE.search(text):
        return "NVIDIA"
    if _VENDOR_AMD_RE.search(text):
        return "AMD"
    if _VENDOR_INTEL_RE.search(text):
        return "Intel"
    return "Unknown"


def _extract_variant(text: str) -> tuple[str, str | None]:
    """Remove the first variant token and return (cleaned_text, normalised_variant)."""
    m = _VARIANT_RE.search(text)
    if not m:
        return text, None
    raw_v = m.group(0)
    variant = re.sub(r"\s+", " ", raw_v).strip().title()  # "ti super" → "Ti Super"
    cleaned = (text[: m.start()] + text[m.end() :]).strip()
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned, variant


def parse_gpu_name(raw: str) -> ParsedGpu:
    """Parse a raw GPU name string into structured fields.

    Never raises. Unknown or malformed strings fall back gracefully.
    """
    text = _COUNT_PREFIX_RE.sub("", raw).strip()
    vendor = _detect_vendor(text)

    # Strip vendor-name tokens from the front and inline
    cleaned = _VENDOR_PREFIX_RE.sub("", text).strip()
    cleaned = _NOISE_RE.sub("", cleaned).strip()
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    cleaned_no_variant, variant = _extract_variant(cleaned)

    lookup = _alias_lookup()
    family: str | None = None
    is_known = False

    # Alias lookup: try most-specific candidates first
    for candidate in (cleaned_no_variant, cleaned, text):
        hit = lookup.get(candidate.strip().lower())
        if hit:
            family = hit
            is_known = True
            break

    if not is_known:
        m = _FAMILY_FALLBACK_RE.search(cleaned_no_variant or cleaned)
        family = m.group(0).strip() if m else (cleaned_no_variant or cleaned or "Unknown").strip()

    return ParsedGpu(
        vendor=vendor,
        family=family or "Unknown",
        variant=variant,
        raw=raw,
        is_known=is_known,
    )


def is_mixed_rig(gpu_array: list[str]) -> bool:
    """Return True when a rig reports more than one distinct GPU type."""
    if not gpu_array:
        return False
    return len({s.strip().lower() for s in gpu_array}) > 1


_CC_SEED_PATH = Path(__file__).parent.parent / "seeds" / "cuda_capability_seed.json"


@lru_cache(maxsize=1)
def _cc_lookup_map() -> dict[str, str]:
    """Build lowercase alias → CC string.

    Priority order (highest to lowest):
    1. Redis hash "gpu:cc_map:v1" — written by seeder, covers all DB profiles
    2. gpu_profiles.json — validated rent-target fallback
    3. cuda_capability_seed.json — broad NVIDIA coverage fallback
    """
    # 1. Redis — single HGETALL, then cached in-process for process lifetime
    try:
        import redis as _redis
        r = _redis.from_url("redis://redis:6379/2", decode_responses=True, socket_connect_timeout=1)
        mapping = r.hgetall("gpu:cc_map:v1")
        if mapping:
            return mapping
    except Exception:
        pass

    # 2 & 3. JSON file fallback (Redis unavailable or not yet seeded)
    result: dict[str, str] = {}
    try:
        for entry in json.loads(_CC_SEED_PATH.read_text(encoding="utf-8")):
            cc = entry.get("cc")
            if not cc:
                continue
            for alias in [entry.get("name", "")] + list(entry.get("aliases") or []):
                if alias:
                    result[alias.lower()] = cc
    except Exception:
        pass

    try:
        for p in json.loads(_PROFILES_PATH.read_text(encoding="utf-8")):
            cc = p.get("cc")
            if not cc:
                continue
            for alias in [p["display_name"]] + list(p.get("aliases") or []):
                result[alias.lower()] = cc
    except Exception:
        pass

    return result


def cc_lookup(raw: str) -> str | None:
    """Return the CUDA compute capability for a raw GPU name string, or None if unknown."""
    lookup = _cc_lookup_map()
    text = _COUNT_PREFIX_RE.sub("", raw).strip()
    cleaned = _VENDOR_PREFIX_RE.sub("", text).strip()
    cleaned = _NOISE_RE.sub("", cleaned).strip()
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned_no_variant, _ = _extract_variant(cleaned)

    for candidate in (text, cleaned, cleaned_no_variant):
        if candidate:
            hit = lookup.get(candidate.strip().lower())
            if hit:
                return hit
    return None
