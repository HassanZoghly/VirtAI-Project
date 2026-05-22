import time

from loguru import logger
from sqlalchemy import text

from app.infrastructure.cache.redis_client import get_redis
from app.infrastructure.db.database import get_db
from app.infrastructure.rag.fastembed_provider import FastEmbedProvider
from app.infrastructure.storage.local_storage import LocalStorageProvider
from app.shared.config import get_settings


async def worker_startup_validation(ctx: dict) -> None:
    settings = get_settings()

    # 1. Ping Redis
    logger.info("Worker startup: Pinging Redis...")
    redis_client = get_redis()
    await redis_client.ping()

    # 2. Test DB + pgvector
    logger.info("Worker startup: Testing DB and pgvector extension...")
    db_gen = get_db()
    db = await anext(db_gen)
    try:
        await db.execute(text("SELECT 1"))
        result = await db.execute(text("SELECT extname FROM pg_extension WHERE extname = 'vector'"))
        if not result.scalar_one_or_none():
            raise RuntimeError("pgvector extension is not installed in the database")
    finally:
        await db.close()

    # 3. Warm FastEmbed
    logger.info("Worker startup: Warming FastEmbed provider...")
    t0 = time.monotonic()
    embedder = FastEmbedProvider(model_name=settings.EMBEDDING_MODEL)
    warmup_ms = int((time.monotonic() - t0) * 1000)

    logger.info(
        {
            "event": "embedding_provider_ready",
            "provider": "FastEmbed",
            "model": settings.EMBEDDING_MODEL,
            "warmup_ms": warmup_ms,
        }
    )

    # Store in context
    ctx["embedder"] = embedder
    ctx["storage"] = LocalStorageProvider(base_path=settings.UPLOAD_BASE_PATH)
    ctx["redis"] = redis_client
    logger.info("Worker startup: All checks passed. Ready to process jobs.")


async def worker_shutdown(ctx: dict) -> None:
    logger.info("Worker shutting down...")
    redis_client = ctx.get("redis")
    if redis_client:
        await redis_client.aclose()
