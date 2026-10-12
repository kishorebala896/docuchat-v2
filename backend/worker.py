"""Celery worker for production ingestion.

Run:  celery -A backend.worker.celery_app worker --loglevel=info --concurrency=4
Set USE_CELERY=true so the API enqueues here instead of BackgroundTasks.
Scale this independently of the API: parsing/embedding is CPU-bound,
chat is I/O-bound -- they scale on different axes.
"""
from celery import Celery

from .config import settings

celery_app = Celery("docuchat", broker=settings.celery_broker)
celery_app.conf.update(
    task_acks_late=True,          # requeue if a worker dies mid-document
    worker_prefetch_multiplier=1,  # fair dispatch across workers
    task_time_limit=1800,          # 30 min hard cap per document
)


@celery_app.task(name="docuchat.ingest", bind=True, max_retries=3)
def ingest_document_task(self, doc_id: str):
    from .pipeline import run_ingestion  # lazy: keeps worker import light

    try:
        run_ingestion(doc_id)
    except Exception as exc:  # noqa: BLE001 -- retry transient failures (OOM, API 429)
        raise self.retry(exc=exc, countdown=60 * (self.request.retries + 1))
