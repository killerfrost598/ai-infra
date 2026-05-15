"""Unit tests for clore_filters — no DB or Redis required."""

import pytest
from app.services.clore_filters import (
    CloreFilters,
    _parse_cuda,
    apply_filters,
)
from app.services.clore_client import CloreOffer


# ── Fixtures ──────────────────────────────────────────────────────────────────

def _offer(**kwargs) -> CloreOffer:
    defaults = dict(
        id="1",
        gpu_name="RTX 4090",
        gpu_count=1,
        vram_gb=24,
        price_per_day=2.0,
        pcie_version="4.0",
        pcie_width=16,
        disk_gb=200,
        download_mbps=1000.0,
        upload_mbps=500.0,
        cuda_version="12.4",
    )
    defaults.update(kwargs)
    return CloreOffer(**defaults)


# ── _parse_cuda ───────────────────────────────────────────────────────────────

def test_parse_cuda_major_minor():
    assert _parse_cuda("12.4") == (12, 4)


def test_parse_cuda_major_only():
    assert _parse_cuda("11") == (11, 0)


def test_parse_cuda_two_digit_minor():
    assert _parse_cuda("12.10") == (12, 10)
    # Ensures no lexical sort bug: 12.10 > 12.2
    assert _parse_cuda("12.10") > _parse_cuda("12.2")


def test_parse_cuda_invalid():
    with pytest.raises(ValueError):
        _parse_cuda("not-a-version")


def test_parse_cuda_empty():
    with pytest.raises(ValueError):
        _parse_cuda("")


# ── apply_filters — individual filters ───────────────────────────────────────

def test_no_filters_returns_all():
    offers = [_offer(id="1"), _offer(id="2")]
    result, applied = apply_filters(offers, CloreFilters())
    assert result == offers
    assert applied == {}


def test_min_pcie_gen_passes():
    offers = [_offer(pcie_version="4.0"), _offer(pcie_version="3.0"), _offer(pcie_version="2.0")]
    result, applied = apply_filters(offers, CloreFilters(min_pcie_gen=3))
    assert len(result) == 2
    assert applied == {"min_pcie_gen": 3}


def test_min_pcie_gen_excludes_missing():
    offers = [_offer(pcie_version="4.0"), _offer(pcie_version=None)]
    result, _ = apply_filters(offers, CloreFilters(min_pcie_gen=3))
    assert len(result) == 1


def test_min_pcie_width_passes():
    offers = [_offer(pcie_width=16), _offer(pcie_width=8), _offer(pcie_width=4)]
    result, applied = apply_filters(offers, CloreFilters(min_pcie_width=8))
    assert len(result) == 2
    assert applied == {"min_pcie_width": 8}


def test_min_disk_gb():
    offers = [_offer(disk_gb=500), _offer(disk_gb=100), _offer(disk_gb=50)]
    result, applied = apply_filters(offers, CloreFilters(min_disk_gb=100))
    assert len(result) == 2
    assert applied == {"min_disk_gb": 100}


def test_min_disk_gb_excludes_none():
    offers = [_offer(disk_gb=200), _offer(disk_gb=None)]
    result, _ = apply_filters(offers, CloreFilters(min_disk_gb=100))
    assert len(result) == 1


def test_min_dl_mbps():
    offers = [_offer(download_mbps=2000.0), _offer(download_mbps=500.0), _offer(download_mbps=100.0)]
    result, _ = apply_filters(offers, CloreFilters(min_dl_mbps=500))
    assert len(result) == 2


def test_min_ul_mbps():
    offers = [_offer(upload_mbps=600.0), _offer(upload_mbps=200.0)]
    result, _ = apply_filters(offers, CloreFilters(min_ul_mbps=500))
    assert len(result) == 1


def test_gpu_query_filters_by_name():
    offers = [_offer(gpu_name="NVIDIA RTX 4090"), _offer(gpu_name="NVIDIA RTX 3090")]
    result, applied = apply_filters(offers, CloreFilters(gpu_query="4090"))
    assert [offer.gpu_name for offer in result] == ["NVIDIA RTX 4090"]
    assert applied == {"gpu_query": "4090"}


def test_max_price_per_day():
    offers = [_offer(id="cheap", price_per_day=1.5), _offer(id="expensive", price_per_day=4.0)]
    result, applied = apply_filters(offers, CloreFilters(max_price_per_day=2.0))
    assert [offer.id for offer in result] == ["cheap"]
    assert applied == {"max_price_per_day": 2.0}


def test_min_cuda():
    offers = [
        _offer(cuda_version="12.4"),
        _offer(cuda_version="12.0"),
        _offer(cuda_version="11.8"),
    ]
    result, applied = apply_filters(offers, CloreFilters(min_cuda="12.0"))
    assert len(result) == 2
    assert applied == {"min_cuda": "12.0"}


def test_min_cuda_excludes_missing():
    offers = [_offer(cuda_version="12.4"), _offer(cuda_version=None)]
    result, _ = apply_filters(offers, CloreFilters(min_cuda="12.0"))
    assert len(result) == 1


def test_min_cuda_invalid_setting_skips_filter():
    offers = [_offer(cuda_version="11.0"), _offer(cuda_version="12.4")]
    # Malformed setting — filter is skipped, all offers pass
    result, _ = apply_filters(offers, CloreFilters(min_cuda="not-valid"))
    assert len(result) == 2


def test_min_vram_total_single_gpu():
    offers = [_offer(gpu_count=1, vram_gb=80), _offer(gpu_count=1, vram_gb=24)]
    result, applied = apply_filters(offers, CloreFilters(min_vram_gb=40))
    assert len(result) == 1
    assert applied == {"min_vram_gb": 40}


def test_min_vram_total_multi_gpu():
    # 3 × 24 GB = 72 GB total — should pass min_vram_gb=72
    offers = [_offer(gpu_count=3, vram_gb=24), _offer(gpu_count=1, vram_gb=24)]
    result, _ = apply_filters(offers, CloreFilters(min_vram_gb=72))
    assert len(result) == 1
    assert result[0].gpu_count == 3


# ── apply_filters — all filters combined ─────────────────────────────────────

def test_all_filters_combined():
    good = _offer(
        id="good",
        pcie_version="4.0", pcie_width=16,
        disk_gb=500, download_mbps=2000.0, upload_mbps=1000.0,
        cuda_version="12.4", gpu_count=1, vram_gb=80,
    )
    bad = _offer(
        id="bad",
        pcie_version="2.0", pcie_width=4,
        disk_gb=50, download_mbps=100.0, upload_mbps=50.0,
        cuda_version="11.0", gpu_count=1, vram_gb=16,
    )
    filters = CloreFilters(
        min_pcie_gen=3, min_pcie_width=8,
        min_disk_gb=100, min_dl_mbps=500, min_ul_mbps=200,
        min_cuda="12.0", min_vram_gb=24,
    )
    result, applied = apply_filters([good, bad], filters)
    assert len(result) == 1
    assert result[0].id == "good"
    assert len(applied) == 7


def test_empty_offer_list():
    result, applied = apply_filters([], CloreFilters(min_pcie_gen=3, min_disk_gb=100))
    assert result == []
    assert "min_pcie_gen" in applied
