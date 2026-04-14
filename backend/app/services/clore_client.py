"""Clore.ai provider client — adapter over the clore-ai SDK (ADR-006)."""

from __future__ import annotations

import logging
import re
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)

try:
    from clore_ai import CloreAI as _CloreAISDK
    _SDK_AVAILABLE = True
except ImportError:
    _SDK_AVAILABLE = False
    _CloreAISDK = None  # type: ignore[assignment,misc]


def _to_float(val: Any) -> float:
    """Convert a value that may be a raw number or a SDK price/spec object to float.

    The clore-ai SDK wraps some fields in typed objects (e.g. ServerPrice).
    We try common numeric attribute names before falling back to 0.0.
    """
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        try:
            return float(val)
        except (ValueError, TypeError):
            return 0.0
    # SDK typed object (e.g. ServerPrice) — probe common attribute names
    for attr in ("on_demand", "usd", "clore", "price", "value", "amount", "cost"):
        candidate = getattr(val, attr, None)
        if candidate is not None:
            if isinstance(candidate, (int, float)):
                return float(candidate)
            if isinstance(candidate, str):
                try:
                    return float(candidate)
                except (ValueError, TypeError):
                    pass
    # Log what we received so we can refine the mapping
    logger.warning("_to_float: unhandled type %s — repr: %.120s", type(val).__name__, repr(val))
    return 0.0


class CloreOffer(BaseModel):
    id: str
    gpu_name: str
    gpu_count: int = 1
    vram_gb: int
    cuda_version: str | None = None
    price_per_day: float
    # Network
    upload_mbps: float | None = None
    download_mbps: float | None = None
    # Hardware
    cpu_model: str | None = None
    ram_gb: int | None = None
    disk_gb: int | None = None
    # PCIe (critical for AI inference GPU ↔ host bandwidth)
    pcie_version: str | None = None
    pcie_width: int | None = None


class CloreServer(BaseModel):
    id: str
    gpu_name: str
    vram_gb: int
    hostname: str
    ssh_port: int
    ssh_username: str
    ssh_password: str | None = None
    cuda_version: str | None = None
    status: str


def _sdk_to_offer(s: Any) -> CloreOffer:
    """Map a clore-ai SDK MarketplaceServer object to our CloreOffer schema.

    Uses direct SDK properties (gpu_count, ram_gb, price_usd) where available,
    then drills into the typed ServerSpecs object for the rest.
    SDK docs: https://docs.clore.ai/python-sdk/marketplace
    """
    # ── Direct SDK properties ──────────────────────────────────────────────────
    # gpu_model includes a count prefix: "2x NVIDIA GeForce RTX 4070"
    raw_model = getattr(s, "gpu_model", None) or "Unknown"
    gpu_name = re.sub(r"^\d+[xX]\s+", "", raw_model).strip() or raw_model

    # gpu_count and ram_gb are direct typed properties (no conversion needed)
    gpu_count = int(getattr(s, "gpu_count", 1) or 1)
    raw_ram = getattr(s, "ram_gb", None)
    ram_gb = int(float(raw_ram)) if raw_ram is not None else None

    # price_usd is the on-demand price in USD per day (Clore quotes daily rates)
    price_per_day = _to_float(getattr(s, "price_usd", None))

    # cuda_version direct property
    cuda_version = getattr(s, "cuda_version", None)

    # ── ServerSpecs object ─────────────────────────────────────────────────────
    # s.specs is a typed ServerSpecs, NOT a dict — use getattr, not .get()
    specs = getattr(s, "specs", None)

    gpu_spec = getattr(specs, "gpu", None) if specs is not None else None
    net_spec = getattr(specs, "net", None) if specs is not None else None
    cpu_spec = getattr(specs, "cpu", None) if specs is not None else None
    disk_spec = getattr(specs, "disk", None) if specs is not None else None

    # VRAM: gpu_spec.ram is in MB (Clore API convention)
    vram_gb = 0
    if gpu_spec is not None:
        vram_raw = _to_float(getattr(gpu_spec, "ram", None))
        vram_gb = int(vram_raw) // 1024 if vram_raw >= 1024 else int(vram_raw)

    # Network speeds
    upload_mbps = (_to_float(getattr(net_spec, "up", None)) or None) if net_spec is not None else None
    download_mbps = (_to_float(getattr(net_spec, "down", None)) or None) if net_spec is not None else None

    # CPU model
    cpu_model = (getattr(cpu_spec, "model", None)) if cpu_spec is not None else None

    # Disk (Clore reports disk.size in GB)
    disk_gb = None
    if disk_spec is not None:
        disk_raw = getattr(disk_spec, "size", None) or getattr(disk_spec, "total", None)
        disk_gb = int(_to_float(disk_raw)) if disk_raw is not None else None

    # PCIe (present on newer Clore API entries; gpu_spec attributes)
    pcie_version = None
    pcie_width = None
    if gpu_spec is not None:
        pv = getattr(gpu_spec, "pcie_version", None)
        pcie_version = str(pv) if pv is not None else None
        pw = getattr(gpu_spec, "pcie_width", None) or getattr(gpu_spec, "pcie_lanes", None)
        pcie_width = int(_to_float(pw)) if pw is not None else None

    return CloreOffer(
        id=str(s.id),
        gpu_name=gpu_name,
        gpu_count=gpu_count,
        vram_gb=vram_gb,
        cuda_version=cuda_version,
        price_per_day=price_per_day,
        upload_mbps=upload_mbps,
        download_mbps=download_mbps,
        cpu_model=cpu_model,
        ram_gb=ram_gb,
        disk_gb=disk_gb,
        pcie_version=pcie_version,
        pcie_width=pcie_width,
    )


def _sdk_order_to_server(order: Any) -> CloreServer:
    cluster = getattr(order, "pub_cluster", None)
    if isinstance(cluster, list) and cluster:
        net = cluster[0]
    else:
        net = {}
    if isinstance(net, dict):
        hostname = str(net.get("address") or "")
        ports = net.get("ports") or {}
        ssh_port = int(ports.get("22/tcp", 22)) if isinstance(ports, dict) else 22
    else:
        hostname = str(getattr(net, "address", ""))
        ssh_port = int(getattr(net, "ssh_port", 22))

    # Guard gpu field against non-dict shapes (fixes AttributeError from old client)
    specs = getattr(order, "specs", None)
    gpu: dict[str, Any] = {}
    if isinstance(specs, dict):
        gpu_raw = specs.get("gpu")
        if isinstance(gpu_raw, dict):
            gpu = gpu_raw

    return CloreServer(
        id=str(order.id),
        gpu_name=gpu.get("model") or getattr(order, "gpu_model", None) or "Unknown",
        vram_gb=int(gpu.get("ram") or 0) // 1024,
        hostname=hostname,
        ssh_port=ssh_port,
        ssh_username="root",
        ssh_password=getattr(order, "ssh_password", None),
        cuda_version=getattr(order, "cuda_version", None),
        status=str(getattr(order, "status", "unknown")),
    )


class CloreClient:
    """Thin adapter over the clore-ai SDK for GPU marketplace operations.

    Preserves the same interface previously provided by the hand-rolled HTTP
    client so that the endpoint layer in clore.py needs no changes.
    """

    def __init__(self, api_key: str) -> None:
        if not _SDK_AVAILABLE:
            raise RuntimeError(
                "clore-ai SDK not installed — run: pip install clore-ai"
            )
        self._sdk: Any = _CloreAISDK(api_key=api_key)

    def list_offers(self, gpu_name: str | None = None) -> list[CloreOffer]:
        """List available GPU marketplace offers."""
        try:
            kwargs: dict[str, Any] = {}
            if gpu_name:
                kwargs["gpu"] = gpu_name
            servers = self._sdk.marketplace(**kwargs)
            return [_sdk_to_offer(s) for s in (servers or [])]
        except Exception as exc:
            raise RuntimeError(f"Failed to list Clore.ai offers: {exc}") from exc

    def list_rentals(self) -> list[CloreServer]:
        """List all active rentals."""
        try:
            orders = self._sdk.my_orders()
            return [_sdk_order_to_server(o) for o in (orders or [])]
        except Exception as exc:
            raise RuntimeError(f"Failed to list Clore.ai rentals: {exc}") from exc

    def get_rental(self, rental_id: str) -> CloreServer:
        """Get details of a specific rental by order ID."""
        rentals = self.list_rentals()
        for rental in rentals:
            if rental.id == rental_id:
                return rental
        raise RuntimeError(f"Rental {rental_id} not found")

    def rent_server(
        self,
        offer_id: str,
        image: str = "cloreai/ubuntu22.04-cuda12",
        ssh_password: str | None = None,
    ) -> CloreServer:
        """Rent a server from Clore.ai and return its details."""
        try:
            kwargs: dict[str, Any] = {
                "server_id": int(offer_id),
                "image": image,
                "type": "on-demand",
                "currency": "CLORE-Blockchain",
            }
            if ssh_password:
                kwargs["ssh_password"] = ssh_password
            order = self._sdk.create_order(**kwargs)
            order_id = str(getattr(order, "id", "") or "")
            return self.get_rental(order_id)
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError(f"Failed to rent server from Clore.ai: {exc}") from exc

    def terminate_rental(self, rental_id: str) -> bool:
        """Terminate a rental."""
        try:
            self._sdk.cancel_order(order_id=int(rental_id))
            return True
        except Exception as exc:
            raise RuntimeError(
                f"Failed to terminate Clore.ai rental {rental_id}: {exc}"
            ) from exc

    def close(self) -> None:
        """No-op: SDK manages its own HTTP sessions."""

    def __enter__(self) -> CloreClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
