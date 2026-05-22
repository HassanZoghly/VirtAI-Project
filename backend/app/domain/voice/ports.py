"""Voice domain ports — abstract interfaces for ASR, TTS, and viseme generation."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from typing import Any

import numpy as np

from app.domain.voice.entities import (
    ASRResult,
    StreamingASRResult,
    TTSChunk,
    TTSResult,
)


class BaseASRProvider(ABC):
    """Abstract ASR provider interface."""

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


class StreamingASRService(ABC):
    """Abstract base class for streaming ASR services"""

    @abstractmethod
    async def transcribe_stream(
        self, audio_data: np.ndarray, sample_rate: int = 16000
    ) -> StreamingASRResult:
        """
        Transcribe accumulated streaming audio data.

        Args:
            audio_data: Float32 PCM audio data (e.g., numpy array)
            sample_rate: Sample rate in Hz (default 16000)

        Returns:
            StreamingASRResult with transcript and metadata
        """
        ...


class BaseTTSProvider(ABC):
    """Abstract TTS provider interface."""

    @abstractmethod
    async def synthesize(self, text: str) -> TTSResult:
        """Convert text to full audio + visemes."""
        ...

    @abstractmethod
    def synthesize_streaming(
        self,
        text: str,
    ) -> AsyncGenerator[TTSChunk, None]:
        """Streaming synthesis — sends audio chunks + visemes as available."""
        ...

    @abstractmethod
    async def generate(
        self,
        text: str,
        session_id: str,
        message_id: str,
        trace_id: str | None = None,
    ) -> TTSResult:
        """Generate audio, store to disk, and return result with file path."""
        ...

    @abstractmethod
    async def get_available_voices(self) -> list[dict[str, str]]:
        """List of available voices."""
        ...

    @abstractmethod
    async def get_voice_settings(self, voice_name: str) -> dict[str, Any]:
        """Get available settings for a specific voice."""
        ...
