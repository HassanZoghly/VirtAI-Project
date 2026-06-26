import time
from typing import Any

from loguru import logger
from sqlalchemy import text

from app.infrastructure.cache.redis_client import get_redis, init_redis
from app.infrastructure.db.database import AsyncSessionLocal
from app.infrastructure.rag.fastembed_provider import FastEmbedProvider
from app.infrastructure.storage.local_storage import LocalStorageProvider
from app.shared.config import get_settings


async def worker_startup_validation(ctx: dict[Any, Any]) -> None:
    settings = get_settings()

    # 1. Ping Redis
    logger.info("Worker startup: Pinging Redis...")
    await init_redis()
    redis_client = get_redis()
    await redis_client.ping()  # type: ignore[misc]

    # 2. Test DB + pgvector
    logger.info("Worker startup: Testing DB and pgvector extension...")
    async with AsyncSessionLocal() as db:
        await db.execute(text("SELECT 1"))
        result = await db.execute(text("SELECT extname FROM pg_extension WHERE extname = 'vector'"))
        if not result.scalar_one_or_none():
            raise RuntimeError("pgvector extension is not installed in the database")

    # 3. Warm Embedding Provider (must match API server configuration)
    logger.info(
        {
            "event": "worker_embedding_provider_start",
            "provider": settings.EMBEDDING_PROVIDER,
            "model": settings.EMBEDDING_MODEL,
        }
    )
    t0 = time.monotonic()
    if settings.EMBEDDING_PROVIDER == "fastembed":
        embedder = FastEmbedProvider(
            model_name=settings.EMBEDDING_MODEL,
            cache_dir=settings.FASTEMBED_CACHE_DIR,
        )
    elif settings.EMBEDDING_PROVIDER == "openai":
        from app.infrastructure.rag.openai_embedder import OpenAIEmbedder

        embedder = OpenAIEmbedder()
    else:
        raise ValueError(
            f"Unsupported EMBEDDING_PROVIDER: {settings.EMBEDDING_PROVIDER}. "
            f"Expected 'fastembed' or 'openai'."
        )
    warmup_ms = int((time.monotonic() - t0) * 1000)

    logger.info(
        {
            "event": "embedding_provider_ready",
            "provider": settings.EMBEDDING_PROVIDER,
            "model": settings.EMBEDDING_MODEL,
            "warmup_ms": warmup_ms,
        }
    )

    # Store in context
    ctx["embedder"] = embedder
    ctx["storage"] = LocalStorageProvider(base_path=settings.UPLOAD_BASE_PATH)
    ctx["redis"] = redis_client
    logger.info("Worker startup: All checks passed. Ready to process jobs.")


async def worker_shutdown(ctx: dict[Any, Any]) -> None:
    logger.info("Worker shutting down...")
    redis_client = ctx.get("redis")
    if redis_client:
        await redis_client.aclose()
