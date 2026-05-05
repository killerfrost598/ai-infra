"""Clore.ai provider client — adapter over the clore-ai SDK (ADR-006).

For operations where the SDK's Pydantic models don't match the real API
(my_orders response shape, create_order response shape), we bypass the SDK
and make direct httpx calls. The SDK is still used for marketplace() and
wallets() which work correctly.

Confirmed SDK bugs (clore-ai==0.1.1, verified 2026-04-18):
- my_orders: pub_cluster is List[str] not str; tcp_ports is List[str] not Dict;
  server_id field is "si" not via alias; always throws ValidationError.
- create_order: real API returns {"code": 0} with no order body; SDK always
  throws ValidationError("id: Field required") even on success.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

import httpx
from pydantic import BaseModel

logger = logging.getLogger(__name__)

_CLORE_API_BASE = "https://api.clore.ai/v1"

try:
    from clore_ai import CloreAI as _CloreAISDK
    _SDK_AVAILABLE = True
except ImportError:
    _SDK_AVAILABLE = False
    _CloreAISDK = None  # type: ignore[assignment,misc]


def _to_float(val: Any) -> float:
    """Convert a value that may be a raw number or a SDK price/spec object to float."""
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        try:
            return float(val)
        except (ValueError, TypeError):
            return 0.0
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
    logger.warning("_to_float: unhandled type %s — repr: %.120s", type(val).__name__, repr(val))
    return 0.0


class CloreOffer(BaseModel):
    id: str
    gpu_name: str
    gpu_count: int = 1
    gpu_array: list[str] = []        # raw per-GPU strings (non-empty for mixed rigs)
    vram_gb: int
    cuda_version: str | None = None
    price_per_day: float
    spot_price_per_day: float | None = None
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
    # Marketplace metadata
    allowed_coins: list[str] = []
    score: float | None = None       # server reliability / uptime score
    mrl: int | None = None           # minimum rental length in hours
    # Parsed GPU fields — None for mixed rigs (excluded from grouped view)
    gpu_vendor: str | None = None
    gpu_family: str | None = None
    gpu_variant: str | None = None
    gpu_cc: str | None = None          # CUDA compute capability e.g. "8.6"


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
    """Map a clore-ai SDK MarketplaceServer object to our CloreOffer schema."""
    from app.services.gpu_name_parser import is_mixed_rig, parse_gpu_name

    # gpu_model includes a count prefix: "2x NVIDIA GeForce RTX 4070"
    raw_model = getattr(s, "gpu_model", None) or "Unknown"
    gpu_name = re.sub(r"^\d+[xX]\s+", "", raw_model).strip() or raw_model

    gpu_count = int(getattr(s, "gpu_count", 1) or 1)
    raw_ram = getattr(s, "ram_gb", None)
    ram_gb = int(float(raw_ram)) if raw_ram is not None else None

    price_per_day = _to_float(getattr(s, "price_usd", None))
    cuda_version = getattr(s, "cuda_version", None)

    specs = getattr(s, "specs", None)

    vram_gb = int(_to_float(getattr(specs, "gpuram", None))) if specs is not None else 0

    net_spec = getattr(specs, "net", None) if specs is not None else None
    upload_mbps = (_to_float(getattr(net_spec, "up", None)) or None) if net_spec is not None else None
    download_mbps = (_to_float(getattr(net_spec, "down", None)) or None) if net_spec is not None else None

    cpu_model = getattr(specs, "cpu", None) if specs is not None else None

    disk_gb = None
    if specs is not None:
        disk_str = getattr(specs, "disk", None)
        if disk_str and isinstance(disk_str, str):
            matches = re.findall(r"(\d+\.?\d*)\s*GB", disk_str, re.IGNORECASE)
            disk_gb = int(float(matches[-1])) if matches else None

    pcie_version = None
    pcie_width = None
    if specs is not None:
        pv = getattr(specs, "pcie_rev", None)
        pcie_version = str(pv) if pv is not None else None
        pw = getattr(specs, "pcie_width", None)
        pcie_width = int(pw) if pw is not None else None

    allowed_coins = list(getattr(s, "allowed_coins", None) or [])

    # GPU array (non-empty for mixed rigs).
    # SDK returns list[list[str]] e.g. [[' GTX 745']], flatten to list[str].
    gpu_array: list[str] = []
    raw_gpu_array = getattr(s, "gpu_array", None)
    if raw_gpu_array:
        for item in raw_gpu_array:
            if isinstance(item, str):
                gpu_array.append(item.strip())
            elif isinstance(item, (list, tuple)) and item:
                gpu_array.append(str(item[0]).strip())

    # Spot price
    spot_price_per_day = None
    price_obj = getattr(s, "price", None)
    if price_obj is not None:
        usd_obj = getattr(price_obj, "usd", None)
        if usd_obj is not None:
            spot_val = getattr(usd_obj, "spot", None)
            if spot_val is not None:
                v = _to_float(spot_val)
                spot_price_per_day = v if v > 0 else None

    # Score and MRL
    score_raw = getattr(s, "score", None)
    score = _to_float(score_raw) if score_raw is not None else None
    score = score if score and score > 0 else None

    mrl_raw = getattr(s, "mrl", None)
    if mrl_raw is None and specs is not None:
        mrl_raw = getattr(specs, "mrl", None)
    mrl = int(mrl_raw) if mrl_raw is not None else None

    # Parse GPU identity — skip for mixed rigs (they appear in list view only)
    if is_mixed_rig(gpu_array):
        gpu_vendor = gpu_family = gpu_variant = gpu_cc = None
    else:
        from app.services.gpu_name_parser import cc_lookup
        parsed = parse_gpu_name(gpu_name)
        gpu_vendor: str | None = parsed.vendor
        gpu_family: str | None = parsed.family
        gpu_variant: str | None = parsed.variant
        gpu_cc: str | None = cc_lookup(gpu_name)

    return CloreOffer(
        id=str(s.id),
        gpu_name=gpu_name,
        gpu_count=gpu_count,
        gpu_array=gpu_array,
        vram_gb=vram_gb,
        cuda_version=cuda_version,
        price_per_day=price_per_day,
        spot_price_per_day=spot_price_per_day,
        upload_mbps=upload_mbps,
        download_mbps=download_mbps,
        cpu_model=cpu_model,
        ram_gb=ram_gb,
        disk_gb=disk_gb,
        pcie_version=pcie_version,
        pcie_width=pcie_width,
        allowed_coins=allowed_coins,
        score=score,
        mrl=mrl,
        gpu_vendor=gpu_vendor,
        gpu_family=gpu_family,
        gpu_variant=gpu_variant,
        gpu_cc=gpu_cc,
    )


def _raw_order_to_server(raw: dict) -> CloreServer:
    """Parse a raw my_orders API dict into CloreServer.

    Real API shapes (verified 2026-04-18):
    - pub_cluster: List[str]  e.g. ["n1.msk.cloreai.ru"]
    - tcp_ports:   List[str]  e.g. ["22:1277"]  (container_port:host_port)
    - specs.gpu:   str with count prefix "1x NVIDIA GeForce RTX 3090"
    - specs.gpuram: float, VRAM in GB
    """
    pub_cluster = raw.get("pub_cluster", [])
    hostname = ""
    if isinstance(pub_cluster, list) and pub_cluster:
        hostname = str(pub_cluster[0])
    elif isinstance(pub_cluster, str):
        hostname = pub_cluster

    tcp_ports_raw = raw.get("tcp_ports", [])
    ssh_port = 22
    if isinstance(tcp_ports_raw, list):
        for entry in tcp_ports_raw:
            if isinstance(entry, str) and entry.startswith("22:"):
                try:
                    ssh_port = int(entry.split(":")[1])
                except (ValueError, IndexError):
                    pass
                break
    elif isinstance(tcp_ports_raw, dict):
        for key in ("22/tcp", "22"):
            if key in tcp_ports_raw:
                try:
                    ssh_port = int(tcp_ports_raw[key])
                except (ValueError, TypeError):
                    pass
                break

    specs = raw.get("specs") or {}
    gpu_raw = specs.get("gpu", "") or ""
    gpu_name = re.sub(r"^\d+[xX]\s+", "", gpu_raw).strip() or "Unknown"
    vram_gb = int(float(specs.get("gpuram") or 0))

    online = raw.get("online", False)
    status = "active" if online else "offline"

    return CloreServer(
        id=str(raw.get("id", "")),
        gpu_name=gpu_name,
        vram_gb=vram_gb,
        hostname=hostname,
        ssh_port=ssh_port,
        ssh_username="root",
        ssh_password=raw.get("ssh_password"),
        cuda_version=None,
        status=status,
    )


def _raise_clore_api_error(code: int | None, result: dict) -> None:
    """Translate Clore API error codes into descriptive RuntimeErrors."""
    if code == 1:
        raise RuntimeError(
            "Clore API code 1 (DB error) — most common causes: "
            "(1) insufficient balance, (2) server just rented by someone else"
        )
    if code == 2:
        raise RuntimeError(f"Clore API invalid input (code 2) — check parameters: {result}")
    if code == 3:
        raise RuntimeError("Clore API auth error (code 3) — check your Clore API key")
    if code == 5:
        raise RuntimeError("Clore API rate limit (code 5) — too many requests, retry later")
    raise RuntimeError(f"Clore API returned unexpected code {code}: {result}")


class CloreClient:
    """Thin adapter over the clore-ai SDK for GPU marketplace operations.

    Uses the SDK for marketplace() and wallets() (which work correctly).
    Uses direct httpx calls for my_orders and create_order (SDK models are
    incompatible with the real API response shapes).
    """

    def __init__(self, api_key: str) -> None:
        if not _SDK_AVAILABLE:
            raise RuntimeError(
                "clore-ai SDK not installed — run: pip install clore-ai"
            )
        self._sdk: Any = _CloreAISDK(api_key=api_key)
        self._api_key = api_key
        self._http = httpx.Client(
            base_url=_CLORE_API_BASE,
            headers={"auth": api_key},
            timeout=30.0,
        )

    def _raw_get(self, endpoint: str, params: dict | None = None) -> dict:
        r = self._http.get(f"/{endpoint}", params=params)
        r.raise_for_status()
        return r.json()

    def _raw_post(self, endpoint: str, data: dict) -> dict:
        r = self._http.post(f"/{endpoint}", json=data)
        r.raise_for_status()
        return r.json()

    def _raw_my_orders(self, return_completed: bool = False) -> list[dict]:
        """Fetch orders via raw HTTP, bypassing the broken SDK Order model."""
        result = self._raw_get(
            "my_orders",
            params={"return_completed": "true" if return_completed else "false"},
        )
        return result.get("orders", [])

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
        """List all active rentals via raw HTTP.

        The SDK's my_orders() throws ValidationError on every order because
        the real API shape doesn't match the SDK's Order model (pub_cluster
        is List[str] not str, tcp_ports is List[str] not Dict, etc.).
        """
        try:
            raw_orders = self._raw_my_orders(return_completed=False)
            return [_raw_order_to_server(o) for o in raw_orders]
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

        Uses direct HTTP instead of sdk.create_order() because the real API
        returns {"code": 0} with no order body, causing the SDK to always raise
        ValidationError("id: Field required") even when the order succeeds.
        """
        try:
            payload: dict[str, Any] = {
                "renting_server": int(offer_id),
                "image": image,
                "type": order_type,
                "currency": currency,
            }
            if ssh_password:
                payload["ssh_password"] = ssh_password
            if ssh_key:
                payload["ssh_key"] = ssh_key
            if ports:
                payload["ports"] = ports
            if env:
                payload["env"] = env
            if command:
                payload["command"] = command
            if jupyter_token:
                payload["jupyter_token"] = jupyter_token
            if spot_price is not None and order_type == "spot":
                payload["spot_price"] = spot_price
            if required_price is not None:
                payload["required_price"] = required_price

            log_payload = {k: "***" if k in ("ssh_password", "ssh_key") else v for k, v in payload.items()}
            logger.info("create_order params: %s", log_payload)

            result = self._raw_post("create_order", payload)
            code = result.get("code")

            if code != 0:
                logger.error("create_order failed — code=%s result=%r", code, result)
                _raise_clore_api_error(code, result)

            logger.info("create_order succeeded (code=0), fetching order details from my_orders")

            # Give Clore a moment to register the new order before polling
            time.sleep(3)

            raw_orders = self._raw_my_orders(return_completed=False)
            server_id_int = int(offer_id)
            matching = [o for o in raw_orders if o.get("si") == server_id_int]

            if not matching:
                raise RuntimeError(
                    f"Order placed (code=0) for server {server_id_int} but it does not "
                    "appear in active orders yet — check Clore.ai dashboard"
                )

            # Most recently created order wins if there are somehow multiple
            matching.sort(key=lambda o: o.get("ct", 0), reverse=True)
            raw_order = matching[0]
            logger.info("Found new order id=%s for server %s", raw_order.get("id"), server_id_int)

            clore_server = _raw_order_to_server(raw_order)
            return clore_server, ssh_password

        except RuntimeError:
            raise
        except httpx.HTTPStatusError as exc:
            logger.error("create_order HTTP error: %s", exc)
            raise RuntimeError(f"Failed to rent server from Clore.ai: HTTP error {exc.response.status_code}") from exc
        except Exception as exc:
            logger.error("create_order unexpected error: %r", exc)
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
        self._http.close()

    def __enter__(self) -> CloreClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()
