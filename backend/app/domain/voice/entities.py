"""Voice domain entities — pure data classes with no external dependencies."""

from dataclasses import dataclass, field


# ── ASR Entities ──────────────────────────────────────────────────────────────
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
    language: str = "en"


@dataclass
class ASRResult:
    """Full result from ASR"""

    transcript: str  # full text
    segments: list[ASRSegment] = field(default_factory=list)
    language: str = "en"
    duration_ms: float = 0.0
    confidence: float = 1.0

    @property
    def is_empty(self) -> bool:
        return not self.transcript.strip()

    @property
    def word_count(self) -> int:
        return len(self.transcript.split())


@dataclass
class StreamingASRResult:
    """Result from streaming ASR transcription"""

    transcript: str
    confidence: float = 1.0
    language: str = "en"
    is_final: bool = True


# ── TTS Entities ──────────────────────────────────────────────────────────────
@dataclass
class VisemeEvent:
    """Single viseme event"""

    offset_ms: float  # Event timestamp
    viseme_id: int  # Viseme ID (0-21)
    duration_ms: float  # Event duration


@dataclass
class WordBoundary:
    """Word boundary event for precise lip sync"""

    word: str
    offset_ms: float  # Start time
    duration_ms: float  # Word duration


@dataclass
class TTSResult:
    """Complete TTS result"""

    audio_bytes: bytes
    visemes: list[VisemeEvent] = field(default_factory=list)
    word_boundaries: list[WordBoundary] = field(default_factory=list)
    audio_duration_ms: float = 0.0
    sample_rate: int = 24000
    format: str = "mp3"
    audio_ref: str | None = None  # Reference to stored audio (e.g. file path or URL)


@dataclass
class TTSChunk:
    """Streaming chunk"""

    audio_data: bytes | None = None  # None if not audio
    viseme: VisemeEvent | None = None  # None if not viseme
    word_boundary: WordBoundary | None = None  # None if not word
    is_done: bool = False
