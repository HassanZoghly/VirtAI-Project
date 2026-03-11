"""Backward-compat shim -- canonical source is app.presentation.ws.gateway."""
from app.presentation.ws.gateway import (  # noqa: F401
    validate_message,
    WebSocketHandler,
)
