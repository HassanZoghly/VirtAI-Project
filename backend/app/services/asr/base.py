from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class WordTimestamp:
    """Single word with its timing"""
    word: str
    start_ms: float
    end_ms: float
    confidence: float = 1.0


@dataclass
class ASRSegment:
    """A segment of transcribed speech"""
    text: str
    start_ms: float
    end_ms: float
    words: list[WordTimestamp] = field(default_factory=list)
    confidence: float = 1.0
    language: str = "en"                            # changed from "ar" to "en"


@dataclass
class ASRResult:
    """Full result from ASR"""
    transcript: str                              # full text
    segments: list[ASRSegment] = field(default_factory=list)
    language: str = "en"                            # changed from "ar" to "en"
    duration_ms: float = 0.0
    confidence: float = 1.0

    @property
    def is_empty(self) -> bool:
        return not self.transcript.strip()

    @property
    def word_count(self) -> int:
        return len(self.transcript.split())


class BaseASRProvider(ABC):

    @abstractmethod
    async def transcribe(
        self,
        audio_bytes: bytes,
        audio_format: str = "webm",
        language: str | None = None,
    ) -> ASRResult:
        """
        Transcribes audio bytes to text.

        Args:
            audio_bytes : raw audio data
            audio_format: file extension (webm, wav, mp3 ...)
            language    : language code (ar, en ...) or None for auto-detect
        """
        ...

    @abstractmethod
    async def is_available(self) -> bool:
        """Health check - is the ASR service reachable?"""
        ...