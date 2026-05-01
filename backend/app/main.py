"""
FastAPI Application Entry Point.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.application.chat.session_manager import SessionManager
from app.infrastructure.cache.redis_client import close_redis, init_redis
from app.infrastructure.db.mongodb import close_mongodb, init_mongodb
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

background_tasks = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup and shutdown logic.
    """
    # ── Startup ───────────────────────────────────────────────────────────────
    setup_logging()
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    logger.info(f"Environment: {settings.ENVIRONMENT}")

    # ── Database & Cache ────────────────────────────────────────────────────────
    await init_mongodb()
    logger.info("MongoDB initialised")

    await init_redis()
    logger.info("Redis initialised")

    # Check for GROQ_API_KEY in development mode
    if not settings.GROQ_API_KEY:
        if settings.ENVIRONMENT == "development":
            logger.warning(
                "⚠️  GROQ_API_KEY is not set! "
                "LLM and ASR features will not work. "
                "WebSocket connections will still be accepted but will return errors for AI features."
            )
        else:
            logger.error(
                "❌ GROQ_API_KEY is required in production mode! "
                "Please set GROQ_API_KEY environment variable."
            )
            raise ValueError("GROQ_API_KEY is required in production mode")

    # Create service factories that use centralized settings
    from app.infrastructure.asr.groq_whisper import GroqWhisperASR
    from app.infrastructure.llm.groq_provider import GroqLLMProvider
    from app.infrastructure.tts.openai_tts_provider import OpenAITTSProvider

    def create_asr_service() -> GroqWhisperASR:
        """Factory function to create ASR service."""
        return GroqWhisperASR()

    def create_llm_service() -> GroqLLMProvider:
        """Factory function to create LLM service with centralized settings."""
        if not settings.GROQ_API_KEY:
            logger.warning("LLM service created without API key - will fail on use")
        return GroqLLMProvider(
            model=settings.LLM_MODEL,
            max_tokens=settings.LLM_MAX_TOKENS,
            temperature=settings.LLM_TEMPERATURE,
            api_key=settings.GROQ_API_KEY or "dummy-key-for-dev",
        )

    def create_tts_service() -> OpenAITTSProvider:
        """Factory function to create TTS service with centralized settings."""
        # Using Kokoro TTS default settings as per migration plan
        return OpenAITTSProvider(
            voice="aria",
            speed=0.8,
        )

    # Initialize session manager with configuration and service factories
    session_manager = SessionManager(
        session_timeout_sec=settings.SESSION_TIMEOUT_SEC,
        session_cleanup_interval=settings.SESSION_CLEANUP_INTERVAL,
        asr_service_factory=create_asr_service,
        llm_service_factory=create_llm_service,
        tts_service_factory=create_tts_service,
    )
    init_session_manager(session_manager)

    ws_connection_manager = WSConnectionManager(history_size=250)
    init_ws_connection_manager(ws_connection_manager)

    # Background task: cleanup idle sessions at configured interval
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
    await close_redis()
    await close_mongodb()
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
    app.add_exception_handler(AvatarBaseException, avatar_exception_handler)  # type: ignore
    app.add_exception_handler(Exception, generic_exception_handler)

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(api_v1_router)
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
