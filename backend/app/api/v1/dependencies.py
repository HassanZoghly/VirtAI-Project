"""
Dependencies for API v1 endpoints.
"""
from typing import Optional
from app.services.pipeline.session_manager import SessionManager

_session_manager: Optional[SessionManager] = None


def get_session_manager() -> SessionManager:
    """Returns the singleton SessionManager instance."""
    global _session_manager
    if _session_manager is None:
        _session_manager = SessionManager()
    return _session_manager


def init_session_manager(manager: SessionManager) -> None:
    """Initializes the session manager (called from main.py lifespan)."""
    global _session_manager
    _session_manager = manager