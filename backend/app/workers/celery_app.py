from celery import Celery

from app.config import settings

celery_app = Celery(
    "dms",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.extraction_worker"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
)


@celery_app.task(name="app.workers.celery_app.ping")
def ping() -> str:
    return "pong"
