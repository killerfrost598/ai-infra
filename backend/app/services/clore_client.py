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


class CloreBalance(BaseModel):
    balances: list[dict] = []


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
    # s.specs is a typed ServerSpecs — fields are flat scalars or a nested NetworkSpecs.
    # Verified field map (from live API debug, 2026-04-13):
    #   specs.gpuram   → float, VRAM per GPU in GB  (e.g. 11.0)
    #   specs.gpu      → str,   "2x NVIDIA GeForce RTX 4070"
    #   specs.cpu      → str,   "Intel(R) Xeon(R) CPU E5-2696 v3 @ 2.30GHz"
    #   specs.cpus     → str,   "18/36"  (physical_cores/threads)
    #   specs.ram      → float, system RAM in GB    (e.g. 31.99)
    #   specs.disk     → str,   "SSDx20240GBx... 174.7393GB"  (trailing float = usable GB)
    #   specs.disk_speed → float, MB/s
    #   specs.pcie_rev → int,   PCIe generation     (e.g. 3)
    #   specs.pcie_width → int, PCIe width lanes    (e.g. 16)
    #   specs.mb       → str,   motherboard model
    #   specs.net      → NetworkSpecs object:
    #     net.up       → float, upload Mbps
    #     net.down     → float, download Mbps
    #     net.cc       → str,   country code
    specs = getattr(s, "specs", None)

    # VRAM: specs.gpuram is already in GB as a float
    vram_gb = int(_to_float(getattr(specs, "gpuram", None))) if specs is not None else 0

    # Network
    net_spec = getattr(specs, "net", None) if specs is not None else None
    upload_mbps = (_to_float(getattr(net_spec, "up", None)) or None) if net_spec is not None else None
    download_mbps = (_to_float(getattr(net_spec, "down", None)) or None) if net_spec is not None else None

    # CPU — flat string on specs
    cpu_model = getattr(specs, "cpu", None) if specs is not None else None

    # Disk — string like "SSDx20240GBx20x20x20 174.7393GB"; extract last GB value
    disk_gb = None
    if specs is not None:
        disk_str = getattr(specs, "disk", None)
        if disk_str and isinstance(disk_str, str):
            matches = re.findall(r"(\d+\.?\d*)\s*GB", disk_str, re.IGNORECASE)
            disk_gb = int(float(matches[-1])) if matches else None

    # PCIe — flat ints on specs (pcie_rev = generation, pcie_width = lane count)
    pcie_version = None
    pcie_width = None
    if specs is not None:
        pv = getattr(specs, "pcie_rev", None)
        pcie_version = str(pv) if pv is not None else None
        pw = getattr(specs, "pcie_width", None)
        pcie_width = int(pw) if pw is not None else None

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
        order_type: str = "on-demand",
        currency: str = "CLORE-Blockchain",
        ssh_password: str | None = None,
        ssh_key: str | None = None,
        ports: dict[str, str] | None = None,
        env: dict[str, str] | None = None,
        command: str | None = None,
        jupyter_token: str | None = None,
        spot_price: float | None = None,
        required_price: float | None = None,
    ) -> tuple[CloreServer, str | None]:
        """Rent a server from Clore.ai and return (CloreServer, ssh_password_used).

        Returns the ssh_password so callers can persist it on the Server record.
        """
        try:
            kwargs: dict[str, Any] = {
                "server_id": int(offer_id),
                "image": image,
                "type": order_type,
                "currency": currency,
            }
            if ssh_password:
                kwargs["ssh_password"] = ssh_password
            if ssh_key:
                kwargs["ssh_key"] = ssh_key
            if ports:
                kwargs["ports"] = ports
            if env:
                kwargs["env"] = env
            if command:
                kwargs["command"] = command
            if jupyter_token:
                kwargs["jupyter_token"] = jupyter_token
            if spot_price is not None and order_type == "spot":
                kwargs["spot_price"] = spot_price
            if required_price is not None:
                kwargs["required_price"] = required_price

            order = self._sdk.create_order(**kwargs)
            order_id = str(getattr(order, "id", "") or "")
            clore_server = self.get_rental(order_id)
            # Propagate back the ssh_password so it can be stored for later SSH connections
            returned_pw = getattr(order, "ssh_password", None) or ssh_password
            return clore_server, returned_pw
        except RuntimeError:
            raise
        except Exception as exc:
            raise RuntimeError(f"Failed to rent server from Clore.ai: {exc}") from exc

    def get_balance(self) -> CloreBalance:
        """Return wallet balances for the authenticated Clore.ai account."""
        try:
            wallets = self._sdk.wallets()
            balances: list[dict] = []
            if isinstance(wallets, list):
                for w in wallets:
                    balances.append({
                        "currency": str(getattr(w, "name", getattr(w, "currency", "unknown"))),
                        "amount": float(getattr(w, "balance", getattr(w, "amount", 0)) or 0),
                    })
            elif isinstance(wallets, dict):
                for k, v in wallets.items():
                    balances.append({"currency": str(k), "amount": float(v or 0)})
            return CloreBalance(balances=balances)
        except Exception as exc:
            raise RuntimeError(f"Failed to get Clore.ai balance: {exc}") from exc

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
