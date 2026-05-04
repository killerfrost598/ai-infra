import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ServerStatus(str, enum.Enum):
    NEW = "NEW"
    PROVISIONING = "PROVISIONING"
    READY = "READY"
    FAILED = "FAILED"
    TERMINATED = "TERMINATED"


class DeploymentStatus(str, enum.Enum):
    PENDING = "PENDING"
    DEPLOYING = "DEPLOYING"
    RUNNING = "RUNNING"
    FAILED = "FAILED"
    STOPPED = "STOPPED"


class TaskStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    PARTIAL = "PARTIAL"


class EngineKind(str, enum.Enum):
    VLLM = "VLLM"
    SGLANG = "SGLANG"
    OLLAMA = "OLLAMA"


class ProviderAccount(Base):
    __tablename__ = "provider_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider_name: Mapped[str] = mapped_column(String(64), nullable=False)
    account_label: Mapped[str] = mapped_column(String(255), nullable=False)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Server(Base):
    __tablename__ = "servers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider_account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("provider_accounts.id", ondelete="SET NULL"), nullable=True
    )
    external_server_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    hostname: Mapped[str] = mapped_column(String(255), nullable=False)
    ssh_port: Mapped[int] = mapped_column(Integer, default=22, nullable=False)
    ssh_username: Mapped[str] = mapped_column(String(128), nullable=False)
    ssh_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ssh_private_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    gpu_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vram_gb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cuda_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ram_gb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    network_bandwidth_mbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    os_image: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[ServerStatus] = mapped_column(Enum(ServerStatus), default=ServerStatus.NEW, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Playbook(Base):
    __tablename__ = "playbooks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    git_repo: Mapped[str] = mapped_column(String(512), nullable=False)
    git_branch: Mapped[str] = mapped_column(String(255), nullable=False, default="main")
    git_commit: Mapped[str | None] = mapped_column(String(128), nullable=True)
    tags: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    requirements_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    model_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_variants.id", ondelete="SET NULL"), nullable=True
    )
    engine: Mapped[EngineKind | None] = mapped_column(Enum(EngineKind), nullable=True)
    source_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PlaybookRunOutcome(Base):
    __tablename__ = "playbook_run_outcomes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    playbook_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("playbooks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    task_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("task_runs.id", ondelete="SET NULL"), nullable=True
    )
    server_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servers.id", ondelete="SET NULL"), nullable=True
    )
    model_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_variants.id", ondelete="SET NULL"), nullable=True
    )
    gpu_model: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    succeeded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ModelDeployment(Base):
    __tablename__ = "model_deployments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False)
    playbook_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("playbooks.id", ondelete="SET NULL"), nullable=True
    )
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    model_alias: Mapped[str | None] = mapped_column(String(255), nullable=True)
    quantization: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tunnel_local_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    remote_port: Mapped[int] = mapped_column(Integer, default=8000, nullable=False)
    status: Mapped[DeploymentStatus] = mapped_column(
        Enum(DeploymentStatus), default=DeploymentStatus.PENDING, nullable=False
    )
    started_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    engine: Mapped[EngineKind | None] = mapped_column(Enum(EngineKind), nullable=True)
    model_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_variants.id", ondelete="SET NULL"), nullable=True
    )
    stack_matrix_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("stack_matrix.id", ondelete="SET NULL"), nullable=True
    )
    install_plan_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    inference_base_url: Mapped[str | None] = mapped_column(String(512), nullable=True)


class TaskRun(Base):
    __tablename__ = "task_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_type: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[TaskStatus] = mapped_column(Enum(TaskStatus), default=TaskStatus.PENDING, nullable=False)
    server_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servers.id", ondelete="SET NULL"), nullable=True
    )
    model_deployment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_deployments.id", ondelete="SET NULL"), nullable=True
    )
    started_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    logs_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    error_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class SessionStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    TERMINATED = "TERMINATED"


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[SessionStatus] = mapped_column(Enum(SessionStatus), default=SessionStatus.ACTIVE, nullable=False)
    started_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    terminated_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pty_log: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    commands: Mapped[list["SessionCommand"]] = relationship(
        "SessionCommand", back_populates="session", order_by="SessionCommand.sequence_num"
    )


class SessionCommand(Base):
    __tablename__ = "session_commands"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False
    )
    sequence_num: Mapped[int] = mapped_column(Integer, nullable=False)
    command: Mapped[str] = mapped_column(Text, nullable=False)
    stdout: Mapped[str] = mapped_column(Text, nullable=False, default="")
    stderr: Mapped[str] = mapped_column(Text, nullable=False, default="")
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    executed_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    session: Mapped["Session"] = relationship("Session", back_populates="commands")


class InferenceBenchmark(Base):
    __tablename__ = "inference_benchmarks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    gpu_model: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    gpu_vram_gb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model_name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    model_family: Mapped[str | None] = mapped_column(Text, nullable=True)
    quantization: Mapped[str | None] = mapped_column(Text, nullable=True)
    tokens_per_second_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    tokens_per_second_p95: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_parallel_connections: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vram_used_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    measured_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ttft_ms_p50: Mapped[float | None] = mapped_column(Float, nullable=True)
    ttft_ms_p95: Mapped[float | None] = mapped_column(Float, nullable=True)
    prefill_tokens_per_second: Mapped[float | None] = mapped_column(Float, nullable=True)
    cold_start_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    concurrency_curve: Mapped[list | None] = mapped_column(JSON, nullable=True)
    knee_concurrency: Mapped[int | None] = mapped_column(Integer, nullable=True)
    profile: Mapped[str | None] = mapped_column(String(16), nullable=True)
    deployment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_deployments.id", ondelete="SET NULL"), nullable=True
    )
    task_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("task_runs.id", ondelete="SET NULL"), nullable=True
    )
    model_variant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_variants.id", ondelete="SET NULL"), nullable=True
    )


class GpuProfile(Base):
    __tablename__ = "gpu_profiles"
    model_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    aliases: Mapped[list | None] = mapped_column(JSON, nullable=True)
    arch: Mapped[str] = mapped_column(String(32), nullable=False)
    cc: Mapped[str] = mapped_column(String(8), nullable=False)
    vram_gb: Mapped[int] = mapped_column(Integer, nullable=False)
    fp8_native: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    bf16: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    marlin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    fa2: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    fa3: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class StackMatrix(Base):
    __tablename__ = "stack_matrix"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cc_min: Mapped[str] = mapped_column(String(8), nullable=False)
    cc_max: Mapped[str | None] = mapped_column(String(8), nullable=True)
    driver_min: Mapped[str] = mapped_column(String(16), nullable=False)
    cuda_runtime: Mapped[str] = mapped_column(String(16), nullable=False)
    torch: Mapped[str] = mapped_column(String(32), nullable=False)
    vllm: Mapped[str | None] = mapped_column(String(32), nullable=True)
    sglang: Mapped[str | None] = mapped_column(String(32), nullable=True)
    container_image: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pip_index_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ModelVariant(Base):
    __tablename__ = "model_variants"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    quant: Mapped[str] = mapped_column(String(32), nullable=False)
    vram_min_gb: Mapped[int] = mapped_column(Integer, nullable=False)
    cc_min: Mapped[str] = mapped_column(String(8), nullable=False)
    arch_supported_vllm: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    arch_supported_sglang: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    num_attention_heads: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tp_allowed_sizes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    context_default: Mapped[int] = mapped_column(Integer, default=8192, nullable=False)
    hf_repo: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class Model(Base):
    __tablename__ = "models"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_key: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    family: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    param_count_b: Mapped[float] = mapped_column(Float, nullable=False)
    hf_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    hf_repo: Mapped[str | None] = mapped_column(String(255), nullable=True)
    max_context_k: Mapped[int] = mapped_column(Integer, nullable=False)
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    use_case: Mapped[str] = mapped_column(String(64), nullable=False, default="chat")
    is_reasoning: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_tools: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_code_model: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_moe: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    moe_active_params_b: Mapped[float | None] = mapped_column(Float, nullable=True)
    num_attention_heads: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tp_allowed_sizes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    kv_cache: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    recommended_engines: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    recommended_flags: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    hf_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    quants: Mapped[list["ModelQuant"]] = relationship("ModelQuant", back_populates="model", cascade="all, delete-orphan", order_by="ModelQuant.quality_score.desc()")


class ModelQuant(Base):
    __tablename__ = "model_quants"
    __table_args__ = (UniqueConstraint("model_id", "name", name="uq_model_quants_model_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    model_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("models.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    hf_repo: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hf_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    bits_per_weight: Mapped[float] = mapped_column(Float, nullable=False)
    disk_size_gb: Mapped[float] = mapped_column(Float, nullable=False)
    vram_weights_gb: Mapped[float] = mapped_column(Float, nullable=False)
    quality_score: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    cc_min: Mapped[str | None] = mapped_column(String(8), nullable=True)
    arch_vllm: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    arch_sglang: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    model: Mapped["Model"] = relationship("Model", back_populates="quants")


class HostCapabilitySnapshot(Base):
    __tablename__ = "host_capability_snapshots"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    captured_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    driver_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cuda_runtime_host: Mapped[str | None] = mapped_column(String(16), nullable=True)
    gpu_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    gpus: Mapped[list | None] = mapped_column(JSON, nullable=True)
    nvlink_topology: Mapped[str | None] = mapped_column(Text, nullable=True)
    homogeneous: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    docker_present: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    nvidia_container_toolkit: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    raw_outputs: Mapped[dict | None] = mapped_column(JSON, nullable=True)
