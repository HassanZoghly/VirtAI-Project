"""Backward-compat shim -- canonical source is app.presentation.http.v1.router."""
from app.presentation.http.v1.router import (  # noqa: F401
    settings,
    router,
    websocket_endpoint,
)
