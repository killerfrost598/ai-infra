from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "AI Inference Platform API"
    app_version: str = "0.1.0"
    environment: str = "development"

    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    backend_cors_origins: str = "http://localhost:3000"

    database_url: str = "postgresql+psycopg2://ai_user:ai_password@postgres:5432/ai_inference"

    celery_broker_url: str = "redis://redis:6379/0"
    celery_result_backend: str = "redis://redis:6379/1"

    clore_api_key: str = "replace_me"
    playbooks_git_repo: str = ""
    playbooks_git_branch: str = "main"
    logs_base_path: str = "/var/log/aip"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.backend_cors_origins.split(",") if origin.strip()]


settings = Settings()
