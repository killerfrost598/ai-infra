import uuid
from unittest.mock import patch

from app.models.entities import (
    EngineKind,
    Model,
    ModelQuant,
    ModelRunAttempt,
    PlaybookRunOutcome,
    RunStatus,
    Server,
    ServerStatus,
    Session,
    SessionStatus,
    TaskRun,
    TaskStatus,
)


def _records(db):
    server = Server(
        external_server_id=f"agent-test-{uuid.uuid4().hex[:8]}",
        hostname="127.0.0.1",
        ssh_username="root",
        status=ServerStatus.READY,
    )
    model = Model(
        model_key=f"agent-model-{uuid.uuid4().hex[:8]}",
        name="Agent Model",
        family="test",
        param_count_b=7.0,
        hf_repo="test/model",
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
        name="bf16",
        hf_repo="test/model",
        bits_per_weight=16.0,
        disk_size_gb=1.0,
        vram_weights_gb=1.0,
        quant_format="bf16",
        tags=[],
    )
    session = Session(
        server_id=server.id,
        label="agent-test",
        status=SessionStatus.ACTIVE,
        metadata_json={
            "host_snapshot": {
                "gpu_count": 1,
                "gpus": [{"name": "NVIDIA Test", "cc": "8.0", "vram_gb": 24, "driver_version": "550.54"}],
                "driver_version": "550.54",
                "cuda_runtime_host": "12.4",
                "homogeneous": True,
                "docker_present": True,
                "nvidia_container_toolkit": True,
            }
        },
    )
    db.add_all([quant, session])
    db.flush()
    return server, session, model, quant


def test_start_agent_run_creates_task_and_model_run(client, db):
    server, session, model, quant = _records(db)
    payload = {
        "server_id": str(server.id),
        "session_id": str(session.id),
        "model_id": str(model.id),
        "quant_id": str(quant.id),
        "engine": "VLLM",
    }
    with patch("app.api.v1.endpoints.lab.session_store.get", return_value=object()):
        with patch("app.api.v1.endpoints.lab.run_agent_task") as run_task:
            resp = client.post("/api/v1/lab/agent-runs", json=payload)

    assert resp.status_code == 202
    body = resp.json()
    assert body["tmux_session"].startswith("inferix-model-")
    task_run = db.query(TaskRun).filter(TaskRun.id == body["task_run_id"]).first()
    model_run = db.query(ModelRunAttempt).filter(ModelRunAttempt.id == body["model_run_id"]).first()
    assert task_run.task_type == "lab.agent_run"
    assert model_run.task_run_id == task_run.id
    assert run_task.called


def test_agent_run_status_and_events(client, db):
    server, session, model, quant = _records(db)
    run = ModelRunAttempt(
        server_id=server.id,
        session_id=session.id,
        model_id=model.id,
        quant_id=quant.id,
        engine=EngineKind.VLLM,
        status=RunStatus.RUNNING,
    )
    db.add(run)
    db.flush()
    task = TaskRun(
        task_type="lab.agent_run",
        status=TaskStatus.RUNNING,
        server_id=server.id,
        metadata_json={
            "model_run_id": str(run.id),
            "session_id": str(session.id),
            "agent": {
                "model_run_id": str(run.id),
                "tmux_session": "inferix-model-test",
                "events": [
                    {
                        "id": "evt1",
                        "ts": "2026-05-08T00:00:00+00:00",
                        "type": "tool_call",
                        "summary": "checked health",
                        "tool": "check_openai_health",
                        "status": "ok",
                    }
                ],
                "steps": [],
                "health": {"models_ok": True},
            },
        },
    )
    db.add(task)
    db.flush()

    resp = client.get(f"/api/v1/lab/agent-runs/{task.id}")
    assert resp.status_code == 200
    assert resp.json()["events"][0]["tool"] == "check_openai_health"

    events_resp = client.get(f"/api/v1/lab/agent-runs/{task.id}/events")
    assert events_resp.status_code == 200
    assert events_resp.json()[0]["summary"] == "checked health"


def test_failed_agent_run_cannot_promote_playbook(client, db):
    server, session, model, quant = _records(db)
    run = ModelRunAttempt(
        server_id=server.id,
        session_id=session.id,
        model_id=model.id,
        quant_id=quant.id,
        engine=EngineKind.VLLM,
        status=RunStatus.FAILED,
        succeeded=False,
    )
    db.add(run)
    db.flush()
    task = TaskRun(
        task_type="lab.agent_run",
        status=TaskStatus.FAILED,
        server_id=server.id,
        metadata_json={
            "model_run_id": str(run.id),
            "agent": {
                "model_run_id": str(run.id),
                "success_ready": True,
                "success_candidate": {"launch_command": "python -m vllm.entrypoints.openai.api_server --model test/model"},
            },
        },
    )
    db.add(task)
    db.flush()

    resp = client.post(f"/api/v1/lab/agent-runs/{task.id}/promote-playbook")
    assert resp.status_code == 422
    assert db.query(PlaybookRunOutcome).filter(PlaybookRunOutcome.task_run_id == task.id).count() == 0


def test_successful_agent_run_promotes_playbook(client, db):
    server, session, model, quant = _records(db)
    run = ModelRunAttempt(
        server_id=server.id,
        session_id=session.id,
        model_id=model.id,
        quant_id=quant.id,
        engine=EngineKind.VLLM,
        status=RunStatus.SUCCESS,
        succeeded=True,
    )
    db.add(run)
    db.flush()
    task = TaskRun(
        task_type="lab.agent_run",
        status=TaskStatus.SUCCESS,
        server_id=server.id,
        metadata_json={
            "model_run_id": str(run.id),
            "agent": {
                "model_run_id": str(run.id),
                "success_ready": True,
                "resources": {"deployment_plan": {"remote_port": 8000, "steps": []}},
                "success_candidate": {
                    "tmux_session": "inferix-model-test",
                    "launch_command": "python -m vllm.entrypoints.openai.api_server --model test/model",
                    "health": {"model_id": "test/model"},
                },
            },
        },
    )
    db.add(task)
    db.flush()

    with patch("app.services.agent_run.write_playbook_to_local_repo", return_value={"git_repo": "/tmp/playbooks", "git_commit": "abc123"}):
        resp = client.post(f"/api/v1/lab/agent-runs/{task.id}/promote-playbook")

    assert resp.status_code == 200
    assert resp.json()["git_commit"] == "abc123"
    assert db.query(PlaybookRunOutcome).filter(PlaybookRunOutcome.task_run_id == task.id).count() == 1
