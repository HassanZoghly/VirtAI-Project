"""
Dependencies for API v1 endpoints.

Canonical location: app.presentation.http.v1.dependencies

Changes from original:
- Removed get_db (SQLAlchemy session) — MongoDB repositories are
  instantiated directly inside service functions (no session-per-request)
- Added get_redis_client dependency for endpoints that need raw cache access
- SessionManager dependency unchanged
"""

from typing import Annotated

import redis.asyncio as aioredis
from fastapi import Depends

from app.shared.config import Settings, get_settings
from app.application.chat.session_manager import SessionManager
from app.infrastructure.cache.redis_client import get_redis

# Application-scoped SessionManager instance
# Initialised in main.py lifespan and stored here
_session_manager: SessionManager | None = None


def init_session_manager(manager: SessionManager) -> None:
    """
    Initialise the session manager (called from main.py lifespan).

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
        RuntimeError: If session manager has not been initialised
    """
    if _session_manager is None:
        raise RuntimeError(
            "SessionManager not initialised. "
            "Ensure init_session_manager() is called in lifespan."
        )
    return _session_manager


def get_redis_client() -> aioredis.Redis:
    """Dependency: return the active Redis client."""
    return get_redis()


# Type aliases for dependency injection
SessionManagerDep = Annotated[SessionManager, Depends(get_session_manager)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
RedisDep = Annotated[aioredis.Redis, Depends(get_redis_client)]
