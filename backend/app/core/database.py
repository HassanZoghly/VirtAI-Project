"""Backward-compat shim - import from app.shared.database instead."""
from app.shared.database import (  # noqa: F401
    Base,
    DATABASE_URL,
    async_session_factory,
    engine,
    get_db,
    init_db,
)
