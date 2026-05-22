import time
from datetime import datetime, timezone

import redis.asyncio as redis
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.rag.stage_machine import IngestionStage
from app.infrastructure.db.database import get_db
from app.infrastructure.db.repositories.document_repository import DocumentRepository
from app.infrastructure.worker.retry_classifier import classify
from app.shared.errors import IngestionCancelledException

LOCK_TTL = 620  # job_timeout (600) + 20s buffer


async def get_short_session() -> AsyncSession:
    """Helper to get a short-lived database session without FastAPI dependency injection."""
    db_gen = get_db()
    return await anext(db_gen)


async def run_ingestion_task(
    ctx: dict,
    doc_id: str,
    user_id: str,
    filename: str,
    file_type: str,
    upload_source: str,
    storage_key: str,
) -> None:
    job_id = ctx["job_id"]
    redis_client: redis.Redis = ctx["redis"]
    lock_key = f"ingestion_lock:{doc_id}"

    log_ctx = {
        "ingestion_job_id": job_id,
        "document_id": doc_id,
        "user_id": user_id,
        "request_id": job_id,  # ARQ jobs have their own IDs, we use it as request_id if none exists
    }

    acquired = await redis_client.set(lock_key, job_id, nx=True, ex=LOCK_TTL)
    if not acquired:
        logger.warning({**log_ctx, "event": "job_skipped_duplicate"})
        return  # Another worker holds the lock — silent exit

    try:
        await _run_ingestion(ctx, doc_id, user_id, filename, file_type, storage_key, log_ctx)
    except IngestionCancelledException:
        logger.info({**log_ctx, "event": "ingestion_cancelled"})
        # The usecase already cleans up. We just mark as CANCELLED.
        async with await get_short_session() as db:
            repo = DocumentRepository(db)
            await repo.mark_cancelled(doc_id)
    except Exception as e:
        import httpx
        from arq import Retry
        from app.application.rag.ingest_document import IngestDocumentUseCase
        
        is_retryable, reason = classify(e)
        logger.error(
            {
                **log_ctx,
                "event": "ingestion_failed",
                "retryable": is_retryable,
                "reason": reason,
                "error": str(e),
            }
        )
        
        # If not retryable or we are aborting, clean up first
        if not is_retryable:
            logger.warning({**log_ctx, "event": "cleaning_up_failed_job"})
            try:
                # Instantiate use case just to call cleanup_failed_job
                use_case = IngestDocumentUseCase(storage=ctx["storage"], parser=None, chunker=None, embedder=None)
                await use_case.cleanup_failed_job(doc_id, storage_key)
            except Exception as cleanup_err:
                logger.error({**log_ctx, "event": "cleanup_failed", "error": str(cleanup_err)})
                
        async with await get_short_session() as db:
            repo = DocumentRepository(db)
            await repo.mark_failed(doc_id, str(e), is_retryable)
            
        if is_retryable:
            # Handle rate limiting / backoff explicitly
            if isinstance(e, httpx.HTTPStatusError) and e.response.status_code in (429, 503):
                retry_after = e.response.headers.get("retry-after")
                defer = int(retry_after) if retry_after and retry_after.isdigit() else 30
                raise Retry(defer=defer)
            raise  # ARQ will retry
    finally:
        # Only release if we own the lock
        current = await redis_client.get(lock_key)
        if current and current.decode() == job_id:
            await redis_client.delete(lock_key)


async def _run_ingestion(
    ctx: dict,
    doc_id: str,
    user_id: str,
    filename: str,
    file_type: str,
    storage_key: str,
    log_ctx: dict,
) -> None:
    from app.application.rag.ingest_document import IngestDocumentUseCase
    from app.infrastructure.rag.markdown_chunker import MarkdownChunker
    from app.infrastructure.rag.pdf_parser import PyMuPDFParser

    embedder = ctx["embedder"]
    storage = ctx["storage"]

    async with await get_short_session() as db:
        repo = DocumentRepository(db)
        doc = await repo.get(doc_id)
        if not doc:
            logger.warning({**log_ctx, "event": "document_not_found"})
            return

        if doc.current_stage == IngestionStage.CANCELLED:
            logger.info({**log_ctx, "event": "job_aborted_cancelled"})
            return

        if doc.current_stage == IngestionStage.COMPLETE:
            logger.info({**log_ctx, "event": "job_aborted_complete"})
            return

        queue_wait_ms = int((datetime.now(timezone.utc) - doc.upload_date).total_seconds() * 1000)
        logger.info({**log_ctx, "event": "job_started", "queue_wait_ms": queue_wait_ms})

    t0 = time.monotonic()

    # Progress Callback
    async def progress_callback(stage: str, pct: int, processed: int, total: int) -> None:
        redis_client = ctx["redis"]
        await redis_client.set(f"doc_progress:{doc_id}", pct, ex=3600)
        async with await get_short_session() as db:
            repo = DocumentRepository(db)
            await repo.update_progress(doc_id, stage, pct, processed, total)

    # Cancellation Check
    async def cancellation_check() -> bool:
        async with await get_short_session() as db:
            repo = DocumentRepository(db)
            stage = await repo.get_stage(doc_id)
            return stage == IngestionStage.CANCELLED

    # Instantiate use case
    use_case = IngestDocumentUseCase(
        storage=storage,
        parser=PyMuPDFParser(),
        chunker=MarkdownChunker(),
        embedder=embedder,
    )

    # Execute
    await use_case.execute(
        doc_id=doc_id,
        user_id=user_id,
        filename=filename,
        file_type=file_type,
        storage_key=storage_key,
        progress_callback=progress_callback,
        cancellation_check=cancellation_check,
        log_ctx=log_ctx,
    )

    duration_ms = int((time.monotonic() - t0) * 1000)
    logger.info({**log_ctx, "event": "ingestion_complete", "duration_ms": duration_ms})
