import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.crypto import SECRET_SETTING_KEYS, decrypt_secret, decrypt_setting_value, encrypt_secret, encrypt_setting_value
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


class Server(Base):
    __tablename__ = "servers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    external_server_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    hostname: Mapped[str] = mapped_column(String(255), nullable=False)
    ssh_port: Mapped[int] = mapped_column(Integer, default=22, nullable=False)
    ssh_username: Mapped[str] = mapped_column(String(128), nullable=False)
    _ssh_password: Mapped[str | None] = mapped_column("ssh_password", Text, nullable=True)
    _ssh_private_key: Mapped[str | None] = mapped_column("ssh_private_key", Text, nullable=True)
    gpu_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vram_gb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cuda_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ram_gb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    network_bandwidth_mbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    os_image: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[ServerStatus] = mapped_column(Enum(ServerStatus), default=ServerStatus.NEW, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    @property
    def ssh_password(self) -> str | None:
        return decrypt_secret(self._ssh_password)

    @ssh_password.setter
    def ssh_password(self, value: str | None) -> None:
        self._ssh_password = encrypt_secret(value)

    @property
    def ssh_private_key(self) -> str | None:
        return decrypt_secret(self._ssh_private_key)

    @ssh_private_key.setter
    def ssh_private_key(self, value: str | None) -> None:
        self._ssh_private_key = encrypt_secret(value)


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
    _value: Mapped[str] = mapped_column("value", Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    @property
    def value(self) -> str:
        if self.key in SECRET_SETTING_KEYS:
            return decrypt_setting_value(self.key, self._value)
        return self._value

    @value.setter
    def value(self, value: str) -> None:
        self._value = encrypt_setting_value(self.key, value)


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
    vram_gb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fp8_native: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    bf16: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    marlin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    fa2: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    fa3: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_full_profile: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


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
    # Extended HF metadata (populated by hf_seeder)
    org: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    architecture: Mapped[str | None] = mapped_column(String(128), nullable=True)
    pipeline_tag: Mapped[str | None] = mapped_column(String(64), nullable=True)
    library_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    license: Mapped[str | None] = mapped_column(String(64), nullable=True)
    languages: Mapped[list | None] = mapped_column(JSON, nullable=True)
    gated: Mapped[str | None] = mapped_column(String(16), nullable=True)
    base_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hf_downloads: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hf_likes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hf_trending_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    hf_last_modified: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hf_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    author: Mapped[str | None] = mapped_column(String(128), nullable=True)
    author_class: Mapped[str | None] = mapped_column(String(16), nullable=True)
    author_label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    author_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
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
    # Extended quant metadata (populated by hf_seeder)
    quant_format: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    quant_variant: Mapped[str | None] = mapped_column(String(32), nullable=True)
    safetensors_dtypes: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    library_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    gated: Mapped[str | None] = mapped_column(String(16), nullable=True)
    hf_downloads: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hf_likes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    author: Mapped[str | None] = mapped_column(String(128), nullable=True)
    author_class: Mapped[str | None] = mapped_column(String(16), nullable=True)
    author_label: Mapped[str | None] = mapped_column(String(128), nullable=True)
    author_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    model: Mapped["Model"] = relationship("Model", back_populates="quants")


class RunStatus(str, enum.Enum):
    PLANNED = "PLANNED"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    ABANDONED = "ABANDONED"


class FailureStage(str, enum.Enum):
    PLAN = "PLAN"
    IMAGE_PULL = "IMAGE_PULL"
    OOM = "OOM"
    CC_MISMATCH = "CC_MISMATCH"
    CUDA_MISMATCH = "CUDA_MISMATCH"
    TIMEOUT = "TIMEOUT"
    HEALTH_CHECK = "HEALTH_CHECK"
    OTHER = "OTHER"


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


class ModelRunAttempt(Base):
    __tablename__ = "model_run_attempts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    quant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_quants.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    host_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("host_capability_snapshots.id", ondelete="SET NULL"), nullable=True
    )
    task_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("task_runs.id", ondelete="SET NULL"), nullable=True
    )

    engine: Mapped[EngineKind] = mapped_column(Enum(EngineKind), nullable=False)
    engine_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    mode: Mapped[str] = mapped_column(String(16), nullable=False, default="container")
    container_image: Mapped[str | None] = mapped_column(String(255), nullable=True)
    container_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    launch_command: Mapped[str] = mapped_column(Text, nullable=False, default="")
    launch_plan_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    feasibility_verdict: Mapped[str] = mapped_column(String(16), nullable=False, default="UNKNOWN")
    forced: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    status: Mapped[RunStatus] = mapped_column(Enum(RunStatus), default=RunStatus.PLANNED, nullable=False)
    succeeded: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    failure_stage: Mapped[FailureStage | None] = mapped_column(Enum(FailureStage), nullable=True)
    failure_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    ttft_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    tps_steady: Mapped[float | None] = mapped_column(Float, nullable=True)
    vram_used_gb: Mapped[float | None] = mapped_column(Float, nullable=True)
    health_check_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    health_check_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    operator_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    published_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    published_sha: Mapped[str | None] = mapped_column(String(128), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_runs_server_started", "server_id", "started_at"),
        Index("ix_runs_model_quant_succeeded", "model_id", "quant_id", "succeeded"),
    )


class LabServerState(Base):
    __tablename__ = "lab_server_state"

    server_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), primary_key=True
    )
    initialized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    vllm_installed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    vllm_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vllm_help_flags: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    active_model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL"), nullable=True
    )
    active_quant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_quants.id", ondelete="SET NULL"), nullable=True
    )
    active_model_repo: Mapped[str | None] = mapped_column(String(255), nullable=True)
    active_port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active_endpoint: Mapped[str | None] = mapped_column(String(512), nullable=True)
    active_profile_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    active_health_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    active_task_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("task_runs.id", ondelete="SET NULL"), nullable=True
    )
    active_model_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_run_attempts.id", ondelete="SET NULL"), nullable=True
    )
    active_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    last_successful_profile_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_failed_profile_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_failure_kind: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_failure_diagnosis_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class InferenceProxyRoute(Base):
    __tablename__ = "inference_proxy_routes"
    __table_args__ = (
        UniqueConstraint("route_slug", name="uq_inference_proxy_routes_route_slug"),
        Index("ix_inference_proxy_routes_server_status", "server_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    route_slug: Mapped[str] = mapped_column(String(96), nullable=False)
    server_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="SET NULL"), nullable=True
    )
    quant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_quants.id", ondelete="SET NULL"), nullable=True
    )
    model_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_run_attempts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    model_name: Mapped[str] = mapped_column(String(255), nullable=False)
    target_base_url: Mapped[str] = mapped_column(String(512), nullable=False)
    remote_port: Mapped[int] = mapped_column(Integer, nullable=False)
    profile_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    hourly_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class InferenceProxyMetric(Base):
    __tablename__ = "inference_proxy_metrics"
    __table_args__ = (
        Index("ix_inference_proxy_metrics_route_created", "route_id", "created_at"),
        Index("ix_inference_proxy_metrics_server_created", "server_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    route_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("inference_proxy_routes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    server_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servers.id", ondelete="SET NULL"), nullable=True
    )
    model_run_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_run_attempts.id", ondelete="SET NULL"), nullable=True
    )
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="chat")
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    ttft_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_per_second: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    effectiveness_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class LabModelCache(Base):
    __tablename__ = "lab_model_caches"
    __table_args__ = (
        UniqueConstraint("server_id", "model_id", "quant_id", "repo_id", name="uq_lab_model_cache_repo"),
        Index("ix_lab_model_caches_server_status", "server_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    server_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("servers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("models.id", ondelete="CASCADE"), nullable=False, index=True
    )
    quant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("model_quants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    repo_id: Mapped[str] = mapped_column(String(255), nullable=False)
    cache_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="unknown")
    total_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cached_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_download_task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("task_runs.id", ondelete="SET NULL"), nullable=True
    )
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
