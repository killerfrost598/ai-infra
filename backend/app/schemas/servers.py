from pydantic import Field, model_validator

from app.models.entities import ServerStatus
from app.schemas.base import BaseSchema, UUIDSchema


class ServerCreate(BaseSchema):
    external_server_id: str
    hostname: str
    ssh_port: int = 22
    ssh_username: str
    ssh_password: str | None = None
    ssh_private_key: str | None = None
    gpu_model: str | None = None
    vram_gb: int | None = None
    cuda_version: str | None = None
    ram_gb: int | None = None
    network_bandwidth_mbps: int | None = None
    os_image: str | None = None


class ServerUpdate(BaseSchema):
    hostname: str | None = None
    ssh_password: str | None = None
    ssh_private_key: str | None = None
    status: ServerStatus | None = None
    gpu_model: str | None = None
    vram_gb: int | None = None
    cuda_version: str | None = None
    ram_gb: int | None = None
    network_bandwidth_mbps: int | None = None
    os_image: str | None = None


class ServerResponse(UUIDSchema):
    external_server_id: str
    hostname: str
    ssh_port: int
    ssh_username: str
    # Populated from ORM but never serialised — replaced by the boolean flags below.
    ssh_password: str | None = Field(default=None, exclude=True)
    ssh_private_key: str | None = Field(default=None, exclude=True)
    has_ssh_password: bool = False
    has_ssh_key: bool = False
    gpu_model: str | None
    vram_gb: int | None
    cuda_version: str | None
    ram_gb: int | None
    network_bandwidth_mbps: int | None
    os_image: str | None
    status: ServerStatus

    @model_validator(mode="after")
    def _derive_auth_flags(self) -> "ServerResponse":
        self.has_ssh_password = bool(self.ssh_password)
        self.has_ssh_key = bool(self.ssh_private_key)
        return self


class ServerListResponse(BaseSchema):
    items: list[ServerResponse]
    total: int
