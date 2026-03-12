"""
Health check endpoints.

Canonical location: app.presentation.http.v1.endpoints.health
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.presentation.http.v1.dependencies import get_session_manager
from app.shared.config import get_settings
from app.application.chat.session_manager import SessionManager

router = APIRouter(prefix="/health", tags=["health"])
settings = get_settings()


@router.get("")
async def health_check():
    """Basic health check endpoint."""
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "environment": settings.ENVIRONMENT,
    }


@router.get("/sessions")
async def sessions_info(
    session_manager: SessionManager = Depends(get_session_manager),
) -> JSONResponse:
    """Returns active session statistics (development only)."""
    if settings.ENVIRONMENT != "development":
        return JSONResponse(status_code=403, content={"error": "Not available in production"})
    stats = session_manager.get_stats()
    return JSONResponse(content=stats)
