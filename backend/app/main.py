"""
FastAPI Application Entry Point.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.core.config import get_settings
from app.core.errors import (
    AvatarBaseException,
    avatar_exception_handler,
    generic_exception_handler,
)
from app.core.logging import setup_logging
from app.api.v1.router import router as api_v1_router
from app.api.v1.dependencies import init_session_manager
from app.services.pipeline.session_manager import SessionManager

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

    # Initialize session manager
    session_manager = SessionManager(session_timeout_sec=300)
    init_session_manager(session_manager)

    # Background task: cleanup idle sessions every 60 seconds
    async def cleanup_task():
        try:
            while True:
                await asyncio.sleep(60)
                removed = await session_manager.cleanup_idle()  # ✅ await هنا
                if removed:
                    logger.info(f"Cleanup: removed {removed} idle sessions")
        except asyncio.CancelledError:
            logger.info("Session cleanup task cancelled")
            raise

    task = asyncio.create_task(cleanup_task(), name="session_cleanup")
    background_tasks.add(task)
    task.add_done_callback(background_tasks.discard)

    logger.info("Session cleanup task started")
    logger.info(f"Server ready on {settings.HOST}:{settings.PORT}")

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("Shutting down...")
    for task in background_tasks:
        task.cancel()
    await asyncio.gather(*background_tasks, return_exceptions=True)
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

    # ── Error Handlers ────────────────────────────────────────────────────────
    app.add_exception_handler(AvatarBaseException, avatar_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)

    # ── Routers ───────────────────────────────────────────────────────────────
    app.include_router(api_v1_router)
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="debug" if settings.DEBUG else "info",
    )