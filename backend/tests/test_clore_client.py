"""Tests for Clore raw API response parsing."""

from app.services.clore_client import _raw_marketplace_to_offer, _raw_order_to_server


def test_raw_marketplace_to_offer_maps_public_shape() -> None:
    offer = _raw_marketplace_to_offer(
        {
            "id": 987,
            "cuda_version": "12.4",
            "price": {"usd": {"on_demand_usd": 2.75, "spot": 1.5}},
            "reliability": 98.5,
            "mrl": 2,
            "allowed_coins": ["CLORE-Blockchain", "USD-Blockchain"],
            "specs": {
                "gpu": "2x NVIDIA GeForce RTX 4090",
                "gpuram": 24,
                "net": {"up": 700, "down": 1800},
                "cpu": "EPYC",
                "ram": 128,
                "disk": "500 GB NVMe",
                "pcie_rev": "4.0",
                "pcie_width": 16,
            },
        }
    )

    assert offer.id == "987"
    assert offer.gpu_name == "NVIDIA GeForce RTX 4090"
    assert offer.gpu_count == 2
    assert offer.vram_gb == 24
    assert offer.price_per_day == 2.75
    assert offer.spot_price_per_day == 1.5
    assert offer.upload_mbps == 700
    assert offer.download_mbps == 1800
    assert offer.disk_gb == 500


def test_raw_order_to_server_maps_billing_fields() -> None:
    server = _raw_order_to_server(
        {
            "id": 123,
            "si": 456,
            "currency": "CLORE-Blockchain",
            "price": 1.25,
            "creation_fee": 0.1,
            "spend": 2.5,
            "ct": 1_714_608_000,
            "pub_cluster": ["node.example.com"],
            "tcp_ports": ["22:12022"],
            "specs": {
                "gpu": "2x NVIDIA GeForce RTX 4090",
                "gpuram": 24,
            },
            "online": True,
        }
    )

    assert server.id == "123"
    assert server.hostname == "node.example.com"
    assert server.ssh_port == 12022
    assert server.gpu_name == "NVIDIA GeForce RTX 4090"
    assert server.vram_gb == 24
    assert server.price_per_day == 1.25
    assert server.currency == "CLORE-Blockchain"
    assert server.creation_fee == 0.1
    assert server.spend == 2.5
    assert server.total_cost == 2.6
    assert server.rented_at == "2024-05-02T00:00:00+00:00"
