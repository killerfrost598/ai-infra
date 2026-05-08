"""Sanitizer tests — deliberately poisoned fixtures to verify no leakage."""

import pytest
from app.services.run_report import sanitize_report, _API_KEY_RE


def _poisoned_report() -> dict:
    """Fixture with every category of sensitive data the sanitizer must strip."""
    return {
        "schema": "inferix/run-report/v1",
        "run_id": "abc12345-dead-beef-cafe-babedeadbeef",
        "published_at": "2026-05-06T12:00:00Z",
        "platform": {"publisher": "inferix"},
        "model": {
            "key": "meta-llama/Llama-3.1-8B-Instruct",
            "family": "llama3",
            "quant_name": "AWQ-4bit",
        },
        "host": {
            "gpu_model": "RTX 4090",
            "gpu_count": 1,
            "nvlink": False,
        },
        "stack": {
            "engine": "vllm",
            "mode": "container",
            "container_image": "192.168.1.5:5000/private/vllm:latest",
        },
        "feasibility": {"verdict": "READY", "forced": False, "checks": []},
        "outcome": {
            "status": "SUCCESS",
            "succeeded": True,
            "failure_message": "Connected to 10.0.0.42 via /root/.ssh/id_rsa",
        },
        "notes": "Worked great! Token: hf_abc1234567890XYZabcdef and sk-ant-api03-secret",
    }


def test_api_key_in_notes_is_redacted():
    report = sanitize_report(_poisoned_report())
    assert "hf_" not in report["notes"]
    assert "sk-ant" not in report["notes"]
    assert "redacted" in report["notes"]


def test_ip_in_container_image_is_redacted():
    report = sanitize_report(_poisoned_report())
    assert "192.168.1.5" not in report["stack"]["container_image"]
    assert "[private-registry]" == report["stack"]["container_image"]


def test_ip_in_failure_message_is_redacted():
    report = sanitize_report(_poisoned_report())
    assert "10.0.0.42" not in report["outcome"]["failure_message"]


def test_home_path_in_failure_message_is_redacted():
    report = sanitize_report(_poisoned_report())
    msg = report["outcome"]["failure_message"]
    assert "/root/.ssh/id_rsa" not in msg


def test_run_id_is_shortened():
    report = sanitize_report(_poisoned_report())
    assert report["run_id"].startswith("run-")
    # Must not contain the full UUID
    assert "dead-beef-cafe" not in report["run_id"]


def test_clean_report_passes_through():
    """A report with no sensitive data should be unchanged in all non-id fields."""
    clean = {
        "schema": "inferix/run-report/v1",
        "run_id": "aaaa1111-bbbb-cccc-dddd-eeeeeeeeeeee",
        "published_at": "2026-05-06T12:00:00Z",
        "platform": {"publisher": "inferix"},
        "model": {"key": "mistralai/Mistral-7B-v0.1", "family": "mistral", "quant_name": "Q4_K_M"},
        "host": {"gpu_model": "RTX 4090", "gpu_count": 1},
        "stack": {"engine": "vllm", "mode": "container", "container_image": "vllm/vllm-openai:v0.6.3"},
        "feasibility": {"verdict": "READY", "forced": False, "checks": []},
        "outcome": {"status": "SUCCESS", "succeeded": True, "failure_message": None},
        "notes": "Stable at concurrency 4 for 30 min.",
    }
    result = sanitize_report(clean)
    assert result["model"]["key"] == "mistralai/Mistral-7B-v0.1"
    assert result["stack"]["container_image"] == "vllm/vllm-openai:v0.6.3"
    assert result["notes"] == "Stable at concurrency 4 for 30 min."


def test_api_key_regex_catches_known_patterns():
    """Smoke test the regex against known API key prefixes."""
    assert _API_KEY_RE.search("hf_abcdefghij1234567890")
    assert _API_KEY_RE.search("sk-abcdefghij1234567890")
    assert _API_KEY_RE.search("ghp_abcdefghij1234567890")
    assert _API_KEY_RE.search("sk-ant-api03-abcdefghij")
    assert not _API_KEY_RE.search("no-key-here")
    assert not _API_KEY_RE.search("hf_short")  # too short
