"""
Dependencies for API v1 endpoints.

Canonical location: app.presentation.http.v1.dependencies
"""

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.config import Settings, get_settings
from app.shared.database import get_db
from app.services.pipeline.session_manager import SessionManager

# Application-scoped SessionManager instance
# This will be initialized in main.py lifespan and stored in app.state
_session_manager: SessionManager | None = None


def init_session_manager(manager: SessionManager) -> None:
    """
    Initialize the session manager (called from main.py lifespan).

    Args:
        manager: SessionManager instance to use for the application
    """
    global _session_manager
    _session_manager = manager


def get_session_manager() -> SessionManager:
    """
    Dependency injection function for SessionManager.

    Returns:
        SessionManager: The application-scoped session manager instance

    Raises:
        RuntimeError: If session manager has not been initialized
    """
    if _session_manager is None:
        raise RuntimeError(
            "SessionManager not initialized. "
            "Ensure init_session_manager() is called in lifespan."
        )
    return _session_manager


# Type alias for dependency injection
SessionManagerDep = Annotated[SessionManager, Depends(get_session_manager)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
DbDep = Annotated[AsyncSession, Depends(get_db)]
