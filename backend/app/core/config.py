from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Inferix API"
    app_version: str = "0.1.0"
    environment: str = "development"

    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    backend_cors_origins: str = "http://localhost:3000"

    database_url: str = "postgresql+psycopg2://inferix_user:change_me@postgres:5432/inferix"

    celery_broker_url: str = "redis://redis:6379/0"
    celery_result_backend: str = "redis://redis:6379/1"
    redis_cache_url: str = "redis://redis:6379/2"

    inferix_api_key: str = ""
    inferix_secret_key: str = ""

    clore_api_key: str = "replace_me"
    playbooks_git_repo: str = ""
    playbooks_git_branch: str = "main"
    logs_base_path: str = "/var/log/inferix"
    inference_proxy_public_base_url: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.backend_cors_origins.split(",") if origin.strip()]


settings = Settings()
