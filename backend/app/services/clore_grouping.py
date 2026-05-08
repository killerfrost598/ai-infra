"""Group CloreOffers by parsed GPU family for the grouped browse view.

Excludes mixed rigs (gpu_family=None). Offers without gpu_family are still
returned in the flat offers list — they just don't appear in groups.
"""
from __future__ import annotations

import re

from pydantic import BaseModel

from app.services.clore_client import CloreOffer


class CloreOfferGroup(BaseModel):
    key: str                     # stable slug e.g. "nvidia:rtx-3090:ti"
    vendor: str | None
    family: str
    variant: str | None
    arch: str | None             # GPU architecture e.g. "Ampere", "Ada Lovelace"
    display_name: str            # "RTX 3090 Ti"
    offer_count: int
    total_gpu_count: int
    vram_min_gb: int
    vram_max_gb: int
    price_min_per_day: float
    price_max_per_day: float
    offer_ids: list[str]
    sample_raw_names: list[str]  # up to 3 distinct raw gpu_name values


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


# Maps first two digits of NVIDIA consumer GPU model number → architecture name
_NVIDIA_CONSUMER_ARCH: dict[str, str] = {
    "10": "Pascal",
    "16": "Turing",
    "20": "Turing",
    "30": "Ampere",
    "40": "Ada Lovelace",
    "50": "Blackwell",
}

# Maps leading letter of NVIDIA datacenter GPU → architecture name
_NVIDIA_DC_ARCH: dict[str, str] = {
    "T": "Turing",
    "A": "Ampere",
    "L": "Ada Lovelace",
    "H": "Hopper",
    "B": "Blackwell",
    "V": "Volta",
    "P": "Pascal",
}


def _derive_arch(family: str, vendor: str | None) -> str | None:
    """Infer GPU architecture from family name and vendor."""
    vendor_lower = (vendor or "").lower()
    fam = family.strip()

    if "nvidia" in vendor_lower or vendor_lower == "":
        # Datacenter: letter prefix like A100, H100, L40, V100, B200, T4
        dc_match = re.match(r"^([TALBHVP])(\d)", fam, re.IGNORECASE)
        if dc_match:
            letter = dc_match.group(1).upper()
            if letter in _NVIDIA_DC_ARCH:
                return _NVIDIA_DC_ARCH[letter]

        # Consumer: RTX/GTX NNxx — grab first two digits of the number
        consumer_match = re.search(r"\b(\d{4,5})\b", fam)
        if consumer_match:
            num = consumer_match.group(1)
            prefix = num[:2]
            if prefix in _NVIDIA_CONSUMER_ARCH:
                return _NVIDIA_CONSUMER_ARCH[prefix]

    if "amd" in vendor_lower or "radeon" in vendor_lower:
        mi_match = re.search(r"\bMI(\d+)", fam, re.IGNORECASE)
        if mi_match:
            return "CDNA"
        rdna_match = re.search(r"\bRX\s*(\d{4})", fam, re.IGNORECASE)
        if rdna_match:
            first_digit = rdna_match.group(1)[0]
            return {"7": "RDNA 3", "6": "RDNA 2", "5": "RDNA 1"}.get(first_digit)

    if "intel" in vendor_lower:
        return "Xe"

    return None


def _make_key(vendor: str | None, family: str, variant: str | None) -> str:
    parts = [_slug(vendor or "unknown"), _slug(family)]
    if variant:
        parts.append(_slug(variant))
    return ":".join(parts)


def group_offers(offers: list[CloreOffer]) -> list[CloreOfferGroup]:
    """Build offer groups sorted by offer_count desc, vram_max desc, family asc."""
    buckets: dict[str, list[CloreOffer]] = {}
    key_meta: dict[str, tuple[str | None, str, str | None]] = {}

    for offer in offers:
        if offer.gpu_family is None:
            continue
        key = _make_key(offer.gpu_vendor, offer.gpu_family, offer.gpu_variant)
        if key not in buckets:
            buckets[key] = []
            key_meta[key] = (offer.gpu_vendor, offer.gpu_family, offer.gpu_variant)
        buckets[key].append(offer)

    groups: list[CloreOfferGroup] = []
    for key, group_offers_list in buckets.items():
        vendor, family, variant = key_meta[key]
        display_name = family + (f" {variant}" if variant else "")

        prices = [o.price_per_day for o in group_offers_list]
        vrams = [o.vram_gb for o in group_offers_list]

        sample_names: list[str] = []
        seen: set[str] = set()
        for o in group_offers_list:
            if o.gpu_name not in seen and len(sample_names) < 3:
                sample_names.append(o.gpu_name)
                seen.add(o.gpu_name)

        groups.append(CloreOfferGroup(
            key=key,
            vendor=vendor,
            family=family,
            variant=variant,
            arch=_derive_arch(family, vendor),
            display_name=display_name,
            offer_count=len(group_offers_list),
            total_gpu_count=sum(o.gpu_count for o in group_offers_list),
            vram_min_gb=min(vrams),
            vram_max_gb=max(vrams),
            price_min_per_day=min(prices),
            price_max_per_day=max(prices),
            offer_ids=[o.id for o in group_offers_list],
            sample_raw_names=sample_names,
        ))

    groups.sort(key=lambda g: (-g.offer_count, -g.vram_max_gb, g.family))
    return groups
