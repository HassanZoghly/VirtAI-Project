"""
Health check endpoints.

Canonical location: app.presentation.http.v1.endpoints.health

Updated to include MongoDB and Redis connectivity status.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from loguru import logger

from app.application.chat.session_manager import SessionManager
from app.infrastructure.cache.auth_session_cache import get_auth_session_cache_stats
from app.infrastructure.cache.token_validation_cache import get_token_validation_cache_stats
from app.presentation.http.v1.dependencies import get_session_manager, get_ws_connection_manager
from app.presentation.ws.connection_manager import WSConnectionManager
from app.shared.config import get_settings

router = APIRouter(prefix="/health", tags=["health"])
settings = get_settings()


@router.get("")
async def health_check() -> dict:
    """Basic health check — also verifies MongoDB and Redis connectivity."""
    status = {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
        "services": {},
    }

    # MongoDB ping
    try:
        from app.infrastructure.db.mongodb import get_database

        await get_database().command("ping")
        status["services"]["mongodb"] = "ok"
    except Exception as e:
        logger.warning(f"[Health] MongoDB ping failed: {e}")
        status["services"]["mongodb"] = "unavailable"
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

    return status


@router.get("/sessions")
async def sessions_info(
    session_manager: SessionManager = Depends(get_session_manager),
    ws_connection_manager: WSConnectionManager = Depends(get_ws_connection_manager),
) -> JSONResponse:
    """Returns active session statistics (development only)."""
    if settings.ENVIRONMENT != "development":
        return JSONResponse(status_code=403, content={"error": "Not available in production"})
    stats = await session_manager.get_stats()
    stats["active_ws_connections"] = ws_connection_manager.active_count
    return JSONResponse(content=stats)


@router.get("/cache")
async def cache_info() -> JSONResponse:
    """Returns auth/token cache counters for hit/miss validation (development only)."""
    if settings.ENVIRONMENT != "development":
        return JSONResponse(status_code=403, content={"error": "Not available in production"})

    return JSONResponse(
        content={
            "auth_session": get_auth_session_cache_stats(),
            "token_validation": get_token_validation_cache_stats(),
        }
    )
