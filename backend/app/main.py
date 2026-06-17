"""FastAPI Application Entry Point."""

from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from loguru import logger

from app.application.chat.session_manager import SessionManager
from app.infrastructure.cache.redis_client import close_redis, init_redis
from app.infrastructure.db.database import close_db, init_db
from app.presentation.http.v1.dependencies import init_session_manager, init_ws_connection_manager
from app.presentation.http.v1.router import router as api_v1_router
from app.presentation.ws.connection_manager import WSConnectionManager
from app.shared.config import get_settings
from app.shared.errors import (
    AvatarBaseException,
    avatar_exception_handler,
    generic_exception_handler,
)
from app.shared.log_config import setup_logging

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup and shutdown logic.
    """
    background_tasks = set()

    # ── Startup ───────────────────────────────────────────────────────────────
    setup_logging()
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    logger.info(f"Environment: {settings.ENVIRONMENT}")

    # ── PostgreSQL + pgvector ────────────────────────────────────────────────
    await init_db()
    logger.info("PostgreSQL + pgvector initialised")

    # ── Redis ────────────────────────────────────────────────────────────────
    await init_redis()
    logger.info("Redis initialised")

    # ── Check GROQ_API_KEY ──────────────────────────────────────────────────
    if not settings.GROQ_API_KEY:
        logger.error("❌ GROQ_API_KEY is missing! " "Please set GROQ_API_KEY environment variable.")
        raise ValueError("GROQ_API_KEY is required")

    # ── RAG Infrastructure ───────────────────────────────────────────────────
    import time

    from arq import create_pool  # type: ignore[import-not-found]
    from arq.connections import RedisSettings  # type: ignore[import-not-found]

    from app.infrastructure.rag.fastembed_provider import FastEmbedProvider
    from app.infrastructure.rag.openai_embedder import OpenAIEmbedder
    from app.infrastructure.storage.local_storage import LocalStorageProvider

    t0 = time.monotonic()
    logger.info(
        {
            "event": "embedding_provider_start",
            "provider": settings.EMBEDDING_PROVIDER,
            "model": settings.EMBEDDING_MODEL,
        }
    )
    try:
        if settings.EMBEDDING_PROVIDER == "fastembed":
            embedder = FastEmbedProvider(
                model_name=settings.EMBEDDING_MODEL,
                cache_dir=settings.FASTEMBED_CACHE_DIR,
            )
        elif settings.EMBEDDING_PROVIDER == "openai":
            embedder = OpenAIEmbedder()
        else:
            raise ValueError(f"Unsupported embedding provider: {settings.EMBEDDING_PROVIDER}")
    except Exception as exc:
        logger.error(
            {
                "event": "embedding_provider_failed",
                "provider": settings.EMBEDDING_PROVIDER,
                "model": settings.EMBEDDING_MODEL,
                "error_type": type(exc).__name__,
                "message": str(exc),
            }
        )
        raise

    warmup_ms = int((time.monotonic() - t0) * 1000)
    logger.info(
        {
            "event": "embedding_provider_ready",
            "provider": settings.EMBEDDING_PROVIDER,
            "model": settings.EMBEDDING_MODEL,
            "warmup_ms": warmup_ms,
        }
    )

    app.state.embedder = embedder
    app.state.storage = LocalStorageProvider(base_path=settings.UPLOAD_BASE_PATH)

    from app.infrastructure.rag.reranker import CrossEncoderReranker, DummyCrossEncoderReranker

    if settings.USE_DUMMY_RERANKER:
        app.state.reranker = DummyCrossEncoderReranker()
        logger.info("[Reranker] Using DummyCrossEncoderReranker (USE_DUMMY_RERANKER=True)")
    else:
        try:
            # CrossEncoderReranker is now lazy: __init__ does NOT import
            # sentence_transformers, so this line is safe even if torchaudio
            # native libs are broken.  The heavy import happens on first rerank().
            app.state.reranker = CrossEncoderReranker(
                model_name="cross-encoder/ms-marco-MiniLM-L-6-v2"
            )
        except Exception as _reranker_exc:
            logger.warning(
                f"[Reranker] CrossEncoderReranker construction failed "
                f"({type(_reranker_exc).__name__}: {_reranker_exc}). "
                "Falling back to DummyCrossEncoderReranker for this session."
            )
            app.state.reranker = DummyCrossEncoderReranker()

    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    app.state.arq_pool = await create_pool(redis_settings)
    logger.info("ARQ pool initialized")

    from app.application.rag.retrieval_use_case import RetrievalUseCase
    from app.application.services.model_policy import FallbackTTSChain, ModelPolicyService
    from app.domain.chat.ports import BaseLLMProvider
    from app.domain.voice.ports import BaseTTSProvider
    from app.infrastructure.asr.groq_whisper import GroqWhisperASR
    from app.infrastructure.llm.groq_provider import GroqLLMProvider
    from app.infrastructure.tts.openai_tts_provider import OpenAITTSProvider

    app.state.model_policy = ModelPolicyService()

    groq_llm = GroqLLMProvider(
        model=settings.LLM_MODEL,
        max_tokens=settings.LLM_MAX_TOKENS,
        temperature=settings.LLM_TEMPERATURE,
        api_key=settings.GROQ_API_KEY,
    )
    openai_tts = OpenAITTSProvider(voice="aria", speed=0.8)

    app.state.model_policy.registry.register_llm("groq_llm", groq_llm)
    app.state.model_policy.registry.register_tts("openai_tts", openai_tts)

    from app.domain.voice.filler_cache import init_filler_cache
    init_filler_cache(openai_tts)

    def create_asr_service() -> GroqWhisperASR:
        return GroqWhisperASR()

    def create_llm_service() -> BaseLLMProvider:
        # Note: Handled by fast-fail at startup
        return app.state.model_policy.router.get_llm_chain()

    def create_tts_service() -> BaseTTSProvider:
        return FallbackTTSChain(OpenAITTSProvider(voice="aria", speed=0.8), fallbacks=[])

    async def create_retrieval_service() -> RetrievalUseCase:
        from app.application.rag.token_budget import TokenBudgetManager
        from app.infrastructure.vector.pgvector_store import SessionManagedPGVectorStore

        return RetrievalUseCase(
            embedder=app.state.embedder,
            vector_store=SessionManagedPGVectorStore(),
            reranker=app.state.reranker,
            budget_manager=TokenBudgetManager(),
        )

    # ── Chat database session factory (provides a fresh AsyncSession per call) ─────
    import contextlib

    @contextlib.asynccontextmanager
    async def get_chat_repo():
        from app.infrastructure.db.database import AsyncSessionLocal
        from app.infrastructure.db.repositories.chat_repository import ChatRepository

        async with AsyncSessionLocal() as db:
            yield ChatRepository(db)
            await db.commit()

    def create_animation_stage():
        from app.application.animation.intelligence_service import AnimationIntelligenceService
        from app.application.voice.pipeline_stages import AnimationStage
        from app.infrastructure.tts.viseme_generator import VisemeGenerator

        return AnimationStage(
            animation_service=AnimationIntelligenceService(), viseme_generator=VisemeGenerator()
        )

    def create_chat_context_cache():
        from app.infrastructure.cache.chat_context_cache import ChatContextCache

        return ChatContextCache()

    # ── Session manager (needs to be updated to accept a repo factory) ───────
    session_manager = SessionManager(
        chat_repository_factory=get_chat_repo,
        session_timeout_sec=settings.SESSION_TIMEOUT_SEC,
        session_cleanup_interval=settings.SESSION_CLEANUP_INTERVAL,
        asr_service_factory=create_asr_service,
        llm_service_factory=create_llm_service,
        tts_service_factory=create_tts_service,
        retrieval_service_factory=create_retrieval_service,
        animation_stage_factory=create_animation_stage,
        chat_context_cache_factory=create_chat_context_cache,
    )
    init_session_manager(session_manager)

    # ── WebSocket connection manager ────────────────────────────────────────
    ws_connection_manager = WSConnectionManager(history_size=250)
    init_ws_connection_manager(ws_connection_manager)
    await ws_connection_manager.start_pubsub_listener()
    pubsub_task = getattr(ws_connection_manager, "_pubsub_task", None)
    if pubsub_task:
        background_tasks.add(pubsub_task)
        pubsub_task.add_done_callback(background_tasks.discard)

    # ── Background task: cleanup idle sessions ──────────────────────────────
    async def cleanup_task():
        try:
            while True:
                await asyncio.sleep(settings.SESSION_CLEANUP_INTERVAL)
                removed = await session_manager.cleanup_idle()
                if removed:
                    logger.info(f"Cleanup: removed {removed} idle sessions")
        except asyncio.CancelledError:
            logger.info("Session cleanup task cancelled")
            raise

    task = asyncio.create_task(cleanup_task(), name="session_cleanup")
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)

    # ── Background task: stale queue recovery ──────────────────────────────
    async def stale_queue_recovery_task():
        try:
            while True:
                await asyncio.sleep(settings.STALE_QUEUE_THRESHOLD_MINUTES * 60)
                from sqlalchemy import text

                from app.infrastructure.db.database import AsyncSessionLocal

                async with AsyncSessionLocal() as db:
                    stmt = text(f"""
                        SELECT id, user_id, filename, file_type, upload_source, storage_key
                        FROM documents
                        WHERE current_stage = 'QUEUED'
                        AND upload_date < NOW() - INTERVAL '{settings.STALE_QUEUE_THRESHOLD_MINUTES} minutes'
                        AND started_at IS NULL
                    """)
                    result = await db.execute(stmt)
                    rows = result.fetchall()
                    for row in rows:
                        await app.state.arq_pool.enqueue_job(
                            "run_ingestion_task",
                            doc_id=str(row.id),
                            user_id=str(row.user_id),
                            filename=row.filename,
                            file_type=row.file_type,
                            upload_source=row.upload_source,
                            storage_key=row.storage_key,
                        )
                        logger.warning({"event": "stale_job_recovered", "document_id": str(row.id)})
        except asyncio.CancelledError:
            logger.info("Stale queue recovery task cancelled")
            raise

    stale_task = asyncio.create_task(stale_queue_recovery_task(), name="stale_queue_recovery")
    background_tasks.add(stale_task)
    stale_task.add_done_callback(background_tasks.discard)

    logger.info(
        f"Session cleanup task started | "
        f"timeout={settings.SESSION_TIMEOUT_SEC}s | "
        f"interval={settings.SESSION_CLEANUP_INTERVAL}s"
    )
    logger.info(f"Server ready on {settings.HOST}:{settings.PORT}")

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("Shutting down...")
    for task in background_tasks:
        task.cancel()
    await asyncio.gather(*background_tasks, return_exceptions=True)
    arq_pool = getattr(app.state, "arq_pool", None)
    if arq_pool is not None:
        await arq_pool.close()
    await close_redis()
    await close_db()
    from app.infrastructure.rag.fastembed_provider import FastEmbedProvider
    FastEmbedProvider.shutdown_executor()
    from app.infrastructure.rag.reranker import CrossEncoderReranker
    # Only shut down the executor if the real reranker was ever loaded
    if not CrossEncoderReranker._import_failed:
        CrossEncoderReranker.shutdown_executor()
    logger.info("Server shutdown complete")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        debug=settings.DEBUG,
        lifespan=lifespan,
        docs_url="/docs" if settings.DEBUG else None,
        redoc_url="/redoc" if settings.DEBUG else None,
    )

    @app.middleware("http")
    async def correlation_id_middleware(request: Request, call_next) -> Response:
        from app.shared.request_context import set_trace_id

        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id

        # Set unified trace context
        set_trace_id(request_id)

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    # ── CORS ──────────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── CSRF ──────────────────────────────────────────────────────────────────
    from app.shared.csrf import CSRFMiddleware

    app.add_middleware(CSRFMiddleware)

    # ── Error Handlers ────────────────────────────────────────────────────────
    app.add_exception_handler(AvatarBaseException, avatar_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)

    # ── JWKS Endpoint ─────────────────────────────────────────────────────────
    @app.get("/.well-known/jwks.json", tags=["auth"])
    async def jwks_endpoint():
        from app.shared.key_manager import get_jwks

        return get_jwks()

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(api_v1_router)

    # ── Prometheus Metrics ────────────────────────────────────────────────────
    from prometheus_fastapi_instrumentator import Instrumentator  # type: ignore[import-not-found]

    Instrumentator().instrument(app).expose(app, endpoint="/metrics")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="debug" if settings.DEBUG else "info",
        ws_max_size=settings.WS_MAX_MESSAGE_SIZE,
    )
