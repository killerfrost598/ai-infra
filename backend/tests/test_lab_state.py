from app.models.entities import Model, ModelQuant, Server, ServerStatus
from app.services.lab_state import (
    lab_state_response,
    mark_active_model,
    mark_launch_failure,
    mark_server_initialized,
    mark_vllm_installed,
    upsert_model_cache,
)


def _fixtures(db):
    server = Server(
        external_server_id="lab-state-test",
        hostname="127.0.0.1",
        ssh_username="root",
        status=ServerStatus.READY,
        gpu_model="RTX 3060",
        vram_gb=12,
    )
    model = Model(
        model_key="test/model",
        name="Test Model",
        family="test",
        param_count_b=4,
        max_context_k=8,
        tags=[],
        kv_cache={},
        recommended_engines=[],
        recommended_flags={},
    )
    db.add_all([server, model])
    db.flush()
    quant = ModelQuant(
        model_id=model.id,
        name="FP8",
        hf_repo="test/model-fp8",
        bits_per_weight=8,
        disk_size_gb=4,
        vram_weights_gb=4,
        quality_score=1,
        quant_format="fp8",
        tags=[],
    )
    db.add(quant)
    db.commit()
    return server, model, quant


def test_lab_state_persists_readiness_cache_active_and_failure(db):
    server, model, quant = _fixtures(db)

    mark_server_initialized(db, server.id)
    mark_vllm_installed(db, server.id, version="0.9.0", help_text="usage: vllm serve --cpu-offload-gb --kv-cache-dtype")
    upsert_model_cache(
        db,
        server_id=server.id,
        model_id=model.id,
        quant_id=quant.id,
        repo_id="test/model-fp8",
        status="ready",
        total_bytes=10,
        cached_bytes=10,
    )
    mark_active_model(
        db,
        server_id=server.id,
        model_id=model.id,
        quant_id=quant.id,
        repo_id="test/model-fp8",
        port=8000,
        profile={"max_model_len": 4096, "gpu_memory_utilization": 0.75},
    )
    mark_launch_failure(
        db,
        server_id=server.id,
        profile={"max_model_len": 8192},
        log_text="RuntimeError: CUDA out of memory during memory profiling",
    )

    state = lab_state_response(db, server.id)

    assert state.initialized is True
    assert state.vllm_installed is True
    assert state.vllm_version == "0.9.0"
    assert "--cpu-offload-gb" in state.vllm_supported_flags
    assert state.downloaded_models[0].status == "ready"
    assert state.active_model is not None
    assert state.active_model.port == 8000
    assert state.last_failure_kind == "cuda_oom"
    assert state.last_failure_diagnosis[0].issue_id == "cuda_oom"
