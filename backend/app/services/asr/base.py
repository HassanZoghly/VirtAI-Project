"""Backward-compat shim - canonical source is app.domain.voice.entities + app.domain.voice.ports."""
from app.domain.voice.entities import (  # noqa: F401
    ASRResult,
    ASRSegment,
    StreamingASRResult,
    WordTimestamp,
)
from app.domain.voice.ports import BaseASRProvider, StreamingASRService  # noqa: F401
