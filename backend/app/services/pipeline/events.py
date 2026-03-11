"""Backward-compat shim - canonical source is app.domain.chat.entities."""
from app.domain.chat.entities import (  # noqa: F401
    PipelineEvent,
    PipelineEventType,
    ev,
)
