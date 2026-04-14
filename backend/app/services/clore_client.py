"""Clore.ai provider client — adapter over the clore-ai SDK (ADR-006)."""

from __future__ import annotations

import logging
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)

try:
    from clore_ai import CloreAI as _CloreAISDK
    _SDK_AVAILABLE = True
except ImportError:
    _SDK_AVAILABLE = False
    _CloreAISDK = None  # type: ignore[assignment,misc]


class CloreOffer(BaseModel):
    id: str
    gpu_name: str
    gpu_count: int = 1
    vram_gb: int
    cuda_version: str | None = None
    price_per_hour: float
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
    """Map a clore-ai SDK marketplace server object to our CloreOffer schema.

    The SDK wraps the raw Clore.ai REST response. Specs live under s.specs (dict).
    We use defensive multi-path access because the SDK attribute names differ from
    what the underlying JSON keys are named — field names verified against live API.
    """
    # Pull nested specs dict (same structure as order objects)
    specs: dict[str, Any] = {}
    raw_specs = getattr(s, "specs", None)
    if isinstance(raw_specs, dict):
        specs = raw_specs

    gpu_spec: dict[str, Any] = {}
    raw_gpu = specs.get("gpu")
    if isinstance(raw_gpu, dict):
        gpu_spec = raw_gpu

    net_spec: dict[str, Any] = {}
    raw_net = specs.get("net")
    if isinstance(raw_net, dict):
        net_spec = raw_net

    cpu_spec: dict[str, Any] = {}
    raw_cpu = specs.get("cpu")
    if isinstance(raw_cpu, dict):
        cpu_spec = raw_cpu

    disk_spec: dict[str, Any] = {}
    raw_disk = specs.get("disk")
    if isinstance(raw_disk, dict):
        disk_spec = raw_disk

    # GPU name: prefer specs.gpu.model, fall back to top-level gpu_model attribute
    gpu_name = gpu_spec.get("model") or getattr(s, "gpu_model", None) or "Unknown"

    # GPU count
    gpu_count = int(gpu_spec.get("count", 1) or 1)

    # VRAM: specs.gpu.ram is in MB on the Clore API — convert to GB.
    # Fall back to any direct vram_* attribute (may already be in GB).
    vram_mb = gpu_spec.get("ram") or 0
    if vram_mb and int(vram_mb) > 1024:
        vram_gb = int(vram_mb) // 1024
    else:
        # Fallback: try direct attribute (may be in GB already)
        vram_gb = int(getattr(s, "vram_gb", None) or vram_mb or 0)

    # Price per hour: try multiple attribute names (API inconsistency across SDK versions)
    price_per_hour = float(
        getattr(s, "min_price_on_demand", None)
        or getattr(s, "price_on_demand", None)
        or getattr(s, "price_per_hour", None)
        or getattr(s, "price_usd_per_hour", None)
        or getattr(s, "price", None)
        or specs.get("price")
        or 0.0
    )

    # Network speeds (Mbps)
    upload_mbps = float(net_spec.get("up") or 0) or None
    download_mbps = float(net_spec.get("down") or 0) or None

    # CPU
    cpu_model = cpu_spec.get("model") or None

    # System RAM (MB → GB)
    ram_mb = specs.get("ram") or 0
    ram_gb = (int(ram_mb) // 1024) if ram_mb else None

    # Disk GB (Clore API reports disk.size already in GB)
    disk_size = disk_spec.get("size") or disk_spec.get("total") or 0
    disk_gb = int(disk_size) if disk_size else None

    # PCIe info (present in GPU spec on newer Clore API versions)
    pcie_version = str(gpu_spec.get("pcie_version") or "") or None
    pcie_width_raw = gpu_spec.get("pcie_width") or gpu_spec.get("pcie_lanes")
    pcie_width = int(pcie_width_raw) if pcie_width_raw else None

    # CUDA version
    cuda_version = getattr(s, "cuda_version", None) or gpu_spec.get("cuda_version")

    return CloreOffer(
        id=str(s.id),
        gpu_name=gpu_name,
        gpu_count=gpu_count,
        vram_gb=vram_gb,
        cuda_version=cuda_version,
        price_per_hour=price_per_hour,
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
