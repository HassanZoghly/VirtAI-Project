"""
Health check endpoints.

Canonical location: app.presentation.http.v1.endpoints.health

Updated to include MongoDB and Redis connectivity status.
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from loguru import logger

from app.application.chat.session_manager import SessionManager
from app.presentation.http.v1.dependencies import get_session_manager
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
) -> JSONResponse:
    """Returns active session statistics (development only)."""
    if settings.ENVIRONMENT != "development":
        return JSONResponse(status_code=403, content={"error": "Not available in production"})
    stats = session_manager.get_stats()
    return JSONResponse(content=stats)
