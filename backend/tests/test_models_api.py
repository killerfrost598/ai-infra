"""Integration tests for GET /models exclusion filter and POST /seed-defaults."""

import uuid
from unittest.mock import MagicMock, patch

from app.models.entities import Model, ModelQuant


# ── helpers ───────────────────────────────────────────────────────────────────

def _model(db, tag: str, quant_format: str = "gguf", extra_formats: list[str] | None = None) -> Model:
    """Create a throwaway Model with one (or more) quants within the test transaction."""
    m = Model(
        model_key=f"test-{tag}-{uuid.uuid4().hex[:8]}",
        name=f"Test {tag}",
        family="test",
        param_count_b=7.0,
        max_context_k=4,
        tags=[],
        kv_cache={},
        recommended_engines=[],
        recommended_flags={},
    )
    db.add(m)
    db.flush()

    for i, fmt in enumerate([quant_format] + (extra_formats or [])):
        db.add(ModelQuant(
            model_id=m.id,
            name=f"{tag}-q{i}",
            bits_per_weight=4.0,
            disk_size_gb=10.0,
            vram_weights_gb=5.0,
            quant_format=fmt,
            tags=[],
        ))

    db.flush()
    return m


# ── GET /models — exclusion filter ────────────────────────────────────────────

_ENDPOINT = "app.api.v1.endpoints.models.get_excluded_quant_formats"


def test_list_models_no_exclusion_shows_all(client, db):
    m = _model(db, "mlx-no-excl", quant_format="mlx")
    with patch(_ENDPOINT, return_value=set()):
        resp = client.get("/api/v1/models")
    assert resp.status_code == 200
    keys = {item["model_key"] for item in resp.json()}
    assert m.model_key in keys


def test_list_models_excludes_model_with_only_excluded_format(client, db):
    m = _model(db, "mlx-only", quant_format="mlx")
    with patch(_ENDPOINT, return_value={"mlx"}):
        resp = client.get("/api/v1/models")
    assert resp.status_code == 200
    keys = {item["model_key"] for item in resp.json()}
    assert m.model_key not in keys


def test_list_models_keeps_model_with_mixed_formats(client, db):
    # Model has both GGUF and MLX quants — should survive MLX exclusion
    m = _model(db, "mixed", quant_format="gguf", extra_formats=["mlx"])
    with patch(_ENDPOINT, return_value={"mlx"}):
        resp = client.get("/api/v1/models")
    assert resp.status_code == 200
    keys = {item["model_key"] for item in resp.json()}
    assert m.model_key in keys


def test_list_models_excludes_multiple_formats(client, db):
    # A model with only MLX+GGUF quants is excluded when both are in the exclusion list
    m = _model(db, "all-excl", quant_format="mlx", extra_formats=["gguf"])
    with patch(_ENDPOINT, return_value={"mlx", "gguf"}):
        resp = client.get("/api/v1/models")
    assert resp.status_code == 200
    keys = {item["model_key"] for item in resp.json()}
    assert m.model_key not in keys


def test_list_models_keeps_model_with_non_excluded_format(client, db):
    # AWQ quant is present alongside MLX — AWQ is not excluded, model stays visible
    m = _model(db, "awq-safe", quant_format="awq", extra_formats=["mlx"])
    with patch(_ENDPOINT, return_value={"mlx"}):
        resp = client.get("/api/v1/models")
    assert resp.status_code == 200
    keys = {item["model_key"] for item in resp.json()}
    assert m.model_key in keys


def test_list_models_returns_200(client, db):
    with patch(_ENDPOINT, return_value=set()):
        resp = client.get("/api/v1/models")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ── POST /models/seed-defaults ────────────────────────────────────────────────

_REPOS_ENDPOINT = "app.api.v1.endpoints.models.get_default_seed_models"
_TASK = "app.workers.tasks.seed_model_from_hf"


def test_seed_defaults_no_config_returns_409(client, db):
    with patch(_REPOS_ENDPOINT, return_value=[]):
        resp = client.post("/api/v1/models/seed-defaults")
    assert resp.status_code == 409
    assert "No default models" in resp.json()["detail"]


def test_seed_defaults_queues_one_task_per_repo(client, db):
    repos = ["meta-llama/Llama-3.1-8B-Instruct", "mistralai/Mistral-7B-Instruct-v0.3"]
    with patch(_REPOS_ENDPOINT, return_value=repos):
        with patch(_TASK) as mock_task:
            mock_task.delay.return_value = MagicMock(id="fake-task-id")
            resp = client.post("/api/v1/models/seed-defaults")
    assert resp.status_code == 202
    assert mock_task.delay.call_count == 2


def test_seed_defaults_response_body(client, db):
    repos = ["meta-llama/Llama-3.1-8B-Instruct", "mistralai/Mistral-7B-Instruct-v0.3"]
    with patch(_REPOS_ENDPOINT, return_value=repos):
        with patch(_TASK) as mock_task:
            mock_task.delay.return_value = MagicMock(id="fake-task-id")
            resp = client.post("/api/v1/models/seed-defaults")
    body = resp.json()
    assert body["queued"] == 2
    assert set(body["repo_ids"]) == set(repos)
    assert len(body["celery_task_ids"]) == 2


def test_seed_defaults_single_repo(client, db):
    with patch(_REPOS_ENDPOINT, return_value=["meta-llama/Llama-3.1-8B-Instruct"]):
        with patch(_TASK) as mock_task:
            mock_task.delay.return_value = MagicMock(id="single-task")
            resp = client.post("/api/v1/models/seed-defaults")
    assert resp.status_code == 202
    assert resp.json()["queued"] == 1
