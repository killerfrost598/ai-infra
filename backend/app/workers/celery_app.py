from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "ai_inference_platform",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
)


@celery_app.task(name="health.ping")
def ping() -> str:
    return "pong"


import app.workers.tasks  # noqa: E402, F401  — registers all tasks
