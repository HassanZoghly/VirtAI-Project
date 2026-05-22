"""Health check endpoints."""

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from loguru import logger
from sqlalchemy import text

from app.application.chat.session_manager import SessionManager
from app.infrastructure.cache.auth_session_cache import get_auth_session_cache_stats
from app.infrastructure.cache.token_validation_cache import get_token_validation_cache_stats
from app.presentation.http.v1.dependencies import get_session_manager, get_ws_connection_manager
from app.presentation.ws.connection_manager import WSConnectionManager
from app.shared.config import Environment, get_settings

router = APIRouter(prefix="/health", tags=["health"])
settings = get_settings()


@router.get("")
async def health_check(request: Request) -> dict:
    """Basic health check — verifies PostgreSQL and Redis connectivity."""
    status = {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT.value,
        "services": {},
    }

    # PostgreSQL + pgvector ping
    try:
        from app.infrastructure.db.database import engine

        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            # Also check if vector extension is enabled
            result = await conn.execute(
                text("SELECT extname FROM pg_extension WHERE extname = 'vector'")
            )
            has_vector = result.scalar() is not None
        status["services"]["postgresql"] = "ok"
        status["services"]["pgvector"] = "ok" if has_vector else "missing"
        if not has_vector:
            status["status"] = "degraded"
            logger.warning("[Health] pgvector extension not found")
    except Exception as e:
        logger.warning(f"[Health] PostgreSQL ping failed: {e}")
        status["services"]["postgresql"] = "unavailable"
        status["status"] = "degraded"

    # Redis ping
    try:
        from app.infrastructure.cache.redis_client import get_redis

        await get_redis().ping()
        status["services"]["redis"] = "ok"
    except Exception as e:
        logger.warning(f"[Health] Redis ping failed: {e}")
        status["services"]["redis"] = "unavailable"
        status["status"] = "degraded"

    # Embedding provider readiness
    embedder = getattr(request.app.state, "embedder", None)
    if embedder is None:
        status["services"]["embedding_provider"] = "unavailable"
        status["status"] = "degraded"
    else:
        status["services"]["embedding_provider"] = "ok"

    # WebSocket subsystem readiness
    try:
        manager = get_ws_connection_manager()
        status["services"]["websocket"] = {
            "status": "ok",
            "active_connections": manager.active_count,
        }
    except Exception as e:
        logger.warning(f"[Health] WebSocket manager unavailable: {e}")
        status["services"]["websocket"] = "unavailable"
        status["status"] = "degraded"

    return status


@router.get("/sessions")
async def sessions_info(
    session_manager: SessionManager = Depends(get_session_manager),
    ws_connection_manager: WSConnectionManager = Depends(get_ws_connection_manager),
) -> JSONResponse:
    """Returns active session statistics (development only)."""
    if Environment.development != settings.ENVIRONMENT:
        return JSONResponse(status_code=403, content={"error": "Not available in production"})
    stats = await session_manager.get_stats()
    stats["active_ws_connections"] = ws_connection_manager.active_count
    return JSONResponse(content=stats)


@router.get("/cache")
async def cache_info() -> JSONResponse:
    """Returns auth/token cache counters for hit/miss validation (development only)."""
    if Environment.development != settings.ENVIRONMENT:
        return JSONResponse(status_code=403, content={"error": "Not available in production"})
    return JSONResponse(
        content={
            "auth_session": get_auth_session_cache_stats(),
            "token_validation": get_token_validation_cache_stats(),
        }
    )
