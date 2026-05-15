"""Tests for Clore raw API response parsing."""

from app.services.clore_client import _raw_order_to_server


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
