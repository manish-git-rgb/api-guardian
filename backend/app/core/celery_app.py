"""
Celery application instance for API Guardian.

Broker/backend: Memurai (Redis-protocol-compatible, running locally on
Windows via the Memurai Windows service, default port 6379).

Run the worker from `backend/` with:
    celery -A app.core.celery_app worker --loglevel=info --pool=solo

Note: --pool=solo is used because Celery's default prefork pool has
known issues on Windows. Solo pool runs tasks one at a time in the
main worker process, which is fine for a dev/local setup like this.
"""
import os

from celery import Celery
from dotenv import load_dotenv

load_dotenv()

BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")

celery_app = Celery(
    "api_guardian",
    broker=BROKER_URL,
    backend=RESULT_BACKEND,
    include=["app.ai.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)