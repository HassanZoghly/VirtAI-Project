"""Voice subdomain — ASR, TTS, visemes."""

from app.domain.voice.entities import (
    ASRResult,
    ASRSegment,
    StreamingASRResult,
    TTSChunk,
    TTSResult,
    VisemeEvent,
    WordBoundary,
    WordTimestamp,
)
from app.domain.voice.ports import (
    ASRPort,
    BaseASRProvider,
    BaseTTSProvider,
    StreamingASRPort,
    StreamingASRService,
    TTSPort,
    VisemePort,
)

__all__ = [
    "WordTimestamp",
    "ASRSegment",
    "ASRResult",
    "StreamingASRResult",
    "VisemeEvent",
    "WordBoundary",
    "TTSResult",
    "TTSChunk",
    "BaseASRProvider",
    "StreamingASRService",
    "BaseTTSProvider",
    "VisemePort",
    "ASRPort",
    "StreamingASRPort",
    "TTSPort",
]
