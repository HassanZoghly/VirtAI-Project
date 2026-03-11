"""Backward-compat shim -- canonical source is app.presentation.http.v1.endpoints.health."""
from app.presentation.http.v1.endpoints.health import (  # noqa: F401
    router,
    settings,
    health_check,
    sessions_info,
)
