"""Clore.ai offer quality-bar filtering.

Offers failing any active filter are excluded. Filters are read from
``platform_settings`` via ``load_clore_filters(db)`` and applied with
``apply_filters(offers, filters)``.

Total VRAM is computed as ``gpu_count × per_gpu_vram_gb`` — matching
how Clore.ai stacks multiple GPUs in a single rental.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.services.clore_client import CloreOffer

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CloreFilters:
    gpu_query: str | None = None
    min_pcie_gen: int | None = None
    min_pcie_width: int | None = None
    min_disk_gb: int | None = None
    min_dl_mbps: int | None = None
    min_ul_mbps: int | None = None
    min_cuda: str | None = None
    min_vram_gb: int | None = None
    max_price_per_day: float | None = None


def load_clore_filters(db: Session) -> CloreFilters:
    """Read all ``clore_min_*`` settings and return a typed filter object."""
    from app.services.settings_service import get_setting

    def _int(key: str) -> int | None:
        val = get_setting(key, db)
        if not val:
            return None
        try:
            parsed = int(float(val.strip()))
            if key in {"clore_min_dl_mbps", "clore_min_ul_mbps"}:
                return min(parsed, 3000)
            return parsed
        except ValueError:
            logger.warning("clore filter %r has non-integer value %r — ignoring", key, val)
            return None

    def _float(key: str) -> float | None:
        val = get_setting(key, db)
        if not val:
            return None
        try:
            return float(val.strip())
        except ValueError:
            logger.warning("clore filter %r has non-float value %r — ignoring", key, val)
            return None

    return CloreFilters(
        gpu_query=get_setting("clore_gpu_query", db),
        min_pcie_gen=_int("clore_min_pcie_gen"),
        min_pcie_width=_int("clore_min_pcie_width"),
        min_disk_gb=_int("clore_min_disk_gb"),
        min_dl_mbps=_int("clore_min_dl_mbps"),
        min_ul_mbps=_int("clore_min_ul_mbps"),
        min_cuda=get_setting("clore_min_cuda", db),
        min_vram_gb=_int("clore_min_vram_gb"),
        max_price_per_day=_float("clore_max_price_per_day"),
    )


def apply_filters(
    offers: list[CloreOffer],
    f: CloreFilters,
) -> tuple[list[CloreOffer], dict[str, int | float | str | None]]:
    """Return (filtered_offers, applied_filter_dict).

    Each active filter is recorded in ``applied_filter_dict`` so callers can
    surface which constraints removed offers from the result set.

    Offers with missing values for an active filter are excluded (fail-closed).
    """
    result = list(offers)
    applied: dict[str, int | float | str | None] = {}

    if f.gpu_query:
        needle = f.gpu_query.strip().lower()
        if needle:
            applied["gpu_query"] = f.gpu_query.strip()
            result = [o for o in result if needle in o.gpu_name.lower()]

    if f.max_price_per_day is not None:
        applied["max_price_per_day"] = f.max_price_per_day
        result = [o for o in result if o.price_per_day <= f.max_price_per_day]

    if f.min_pcie_gen is not None:
        applied["min_pcie_gen"] = f.min_pcie_gen
        result = [
            o for o in result
            if o.pcie_version is not None and _pcie_gen(o.pcie_version) >= f.min_pcie_gen
        ]

    if f.min_pcie_width is not None:
        applied["min_pcie_width"] = f.min_pcie_width
        result = [o for o in result if (o.pcie_width or 0) >= f.min_pcie_width]

    if f.min_disk_gb is not None:
        applied["min_disk_gb"] = f.min_disk_gb
        result = [o for o in result if (o.disk_gb or 0) >= f.min_disk_gb]

    if f.min_dl_mbps is not None:
        applied["min_dl_mbps"] = f.min_dl_mbps
        result = [o for o in result if (o.download_mbps or 0) >= f.min_dl_mbps]

    if f.min_ul_mbps is not None:
        applied["min_ul_mbps"] = f.min_ul_mbps
        result = [o for o in result if (o.upload_mbps or 0) >= f.min_ul_mbps]

    if f.min_cuda is not None:
        applied["min_cuda"] = f.min_cuda
        try:
            threshold = _parse_cuda(f.min_cuda)
            result = [
                o for o in result
                if o.cuda_version is not None and _safe_cuda(o.cuda_version) >= threshold
            ]
        except ValueError:
            logger.warning("Ignoring malformed clore_min_cuda value: %r", f.min_cuda)

    if f.min_vram_gb is not None:
        applied["min_vram_gb"] = f.min_vram_gb
        result = [o for o in result if o.gpu_count * o.vram_gb >= f.min_vram_gb]

    return result, applied


def _parse_cuda(v: str) -> tuple[int, int]:
    """Parse 'major.minor' into (major, minor).

    Raises ValueError for unparseable strings so callers can skip the filter
    rather than crash.
    """
    parts = v.strip().split(".")
    try:
        major = int(parts[0])
        minor = int(parts[1]) if len(parts) > 1 else 0
        return (major, minor)
    except (ValueError, IndexError) as exc:
        raise ValueError(f"Invalid CUDA version: {v!r}") from exc


def _pcie_gen(v: str) -> float:
    try:
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def _safe_cuda(v: str) -> tuple[int, int]:
    try:
        return _parse_cuda(v)
    except ValueError:
        return (0, 0)
