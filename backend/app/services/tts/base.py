from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncGenerator, Optional, List, Dict


@dataclass
class VisemeEvent:
    """Single viseme event"""
    offset_ms: float      # Event timestamp
    viseme_id: int        # Viseme ID (0-21)
    duration_ms: float    # Event duration


@dataclass
class WordBoundary:
    """Word boundary event for precise lip sync"""
    word: str
    offset_ms: float      # Start time
    duration_ms: float    # Word duration


@dataclass
class TTSResult:
    """Complete TTS result"""
    audio_bytes: bytes
    visemes: List[VisemeEvent] = field(default_factory=list)
    word_boundaries: List[WordBoundary] = field(default_factory=list)
    audio_duration_ms: float = 0.0
    sample_rate: int = 24000
    format: str = "mp3"


@dataclass
class TTSChunk:
    """Streaming chunk"""
    audio_data: Optional[bytes] = None   # None if not audio
    viseme: Optional[VisemeEvent] = None # None if not viseme
    word_boundary: Optional[WordBoundary] = None  # None if not word
    is_done: bool = False


class BaseTTSProvider(ABC):
    """Base class for all TTS providers"""

    @abstractmethod
    async def synthesize(self, text: str) -> TTSResult:
        """
        Convert text to full audio + visemes
        For cases that don't need streaming
        """
        pass

    @abstractmethod
    async def synthesize_streaming(
        self,
        text: str,
    ) -> AsyncGenerator[TTSChunk, None]:
        """
        Streaming synthesis
        Sends audio chunks + visemes as they become available
        """
        pass

    @abstractmethod
    async def get_available_voices(self) -> List[Dict[str, str]]:
        """List of available voices"""
        pass

    @abstractmethod
    async def get_voice_settings(self, voice_name: str) -> Dict[str, any]:
        """Get available settings for a specific voice"""
        pass