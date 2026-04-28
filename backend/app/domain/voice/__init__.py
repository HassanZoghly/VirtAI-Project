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
    "ASRPort",
    "ASRResult",
    "ASRSegment",
    "BaseASRProvider",
    "BaseTTSProvider",
    "StreamingASRPort",
    "StreamingASRResult",
    "StreamingASRService",
    "TTSChunk",
    "TTSPort",
    "TTSResult",
    "VisemeEvent",
    "VisemePort",
    "WordBoundary",
    "WordTimestamp",
]
