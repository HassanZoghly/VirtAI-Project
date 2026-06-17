from arq.connections import RedisSettings  # type: ignore[import-not-found]

from app.infrastructure.worker.ingestion_task import run_ingestion_task
from app.infrastructure.worker.worker_startup import worker_shutdown, worker_startup_validation
from app.shared.config import get_settings

settings = get_settings()



class WorkerSettings:
    functions = [run_ingestion_task]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_tries = 3
    retry_backoff = True
    job_timeout = 600
    health_check_interval = 30
    max_concurrency = 1
    on_startup = worker_startup_validation
    on_shutdown = worker_shutdown
    queue_name = "ingestion"
