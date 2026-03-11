"""Backward-compat shim - canonical source is app.domain.voice.entities + app.domain.voice.ports."""
from app.domain.voice.entities import (  # noqa: F401
    TTSChunk,
    TTSResult,
    VisemeEvent,
    WordBoundary,
)
from app.domain.voice.ports import BaseTTSProvider  # noqa: F401
