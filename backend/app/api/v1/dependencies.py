"""Backward-compat shim -- canonical source is app.presentation.http.v1.dependencies."""
from app.presentation.http.v1.dependencies import (  # noqa: F401
    DbDep,
    SessionManagerDep,
    SettingsDep,
    get_session_manager,
    init_session_manager,
)
