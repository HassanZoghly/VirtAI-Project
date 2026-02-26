"""
Health check endpoints.
"""
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from app.core.config import get_settings
from app.services.pipeline.session_manager import SessionManager
from app.api.v1.dependencies import get_session_manager

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
    session_manager: SessionManager = Depends(get_session_manager)
) -> JSONResponse:
    """Returns active session statistics (development only)."""
    if settings.ENVIRONMENT != "development":
        return JSONResponse(
            status_code=403,
            content={"error": "Not available in production"}
        )
    stats = session_manager.get_stats()
    return JSONResponse(content=stats)