"""
Streaming ASR Provider using faster-whisper.

This implementation provides local transcription using faster-whisper model
with direct numpy array input (PCM float32 format).
"""

from __future__ import annotations

import asyncio
from typing import Optional

import numpy as np
from faster_whisper import WhisperModel
from loguru import logger

from app.core.errors import ASRException
from app.services.asr.base import StreamingASRResult, StreamingASRService


class FasterWhisperASR(StreamingASRService):
    """
    Streaming ASR using faster-whisper.

    Features:
    - Local transcription using faster-whisper (4x faster than OpenAI Whisper)
    - Direct numpy array input (PCM float32 format)
    - No temporary files or format conversion needed
    - Async processing with proper error handling
    """

    def __init__(
        self,
        model_size: str = "base",
        device: str = "cpu",
        compute_type: str = "int8",
        openai_api_key: Optional[str] = None,
    ):
        """
        Initialize faster-whisper ASR service.

        Args:
            model_size: Model size (tiny, base, small, medium, large)
            device: Device to use (cpu or cuda)
            compute_type: Compute type (int8, float16, float32)
            openai_api_key: OpenAI API key for fallback (optional)
        """
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.openai_api_key = openai_api_key
        self._model: Optional[WhisperModel] = None

        logger.info(
            f"FasterWhisperASR initialized | "
            f"model={model_size} | "
            f"device={device} | "
            f"compute_type={compute_type}"
        )

    def _load_model(self) -> WhisperModel:
        """Lazy load the faster-whisper model."""
        if self._model is None:
            logger.info(f"Loading faster-whisper model: {self.model_size}")
            self._model = WhisperModel(
                self.model_size, device=self.device, compute_type=self.compute_type
            )
            logger.success(f"Model {self.model_size} loaded successfully")
        return self._model


    async def _transcribe_local(
        self, audio_data: np.ndarray, sample_rate: int = 16000, language: Optional[str] = None
    ) -> StreamingASRResult:
        """
        Transcribe audio using local faster-whisper model.

        Args:
            audio_data: Float32 numpy array of audio samples in range [-1.0, 1.0]
            sample_rate: Sample rate of the audio (default: 16000 Hz)
            language: Language code (optional, auto-detect if None)

        Returns:
            StreamingASRResult with transcript
        """
        try:
            model = self._load_model()

            # Run transcription in thread pool to avoid blocking
            # faster-whisper accepts numpy arrays directly
            loop = asyncio.get_event_loop()
            segments, info = await loop.run_in_executor(
                None, lambda: model.transcribe(audio_data, language=language, beam_size=5)
            )

            # Collect all segments
            transcript_parts = []
            for segment in segments:
                transcript_parts.append(segment.text)

            transcript = " ".join(transcript_parts).strip()

            if not transcript:
                raise ASRException("No speech detected in audio")

            logger.success(
                f"Local transcription complete | "
                f"language={info.language} | "
                f"confidence={info.language_probability:.2f} | "
                f"text='{transcript[:60]}...'"
            )

            return StreamingASRResult(
                transcript=transcript,
                confidence=info.language_probability,
                language=info.language,
                is_final=True,
            )

        except Exception as e:
            # Comprehensive error logging with audio metadata (Requirement 10.3, 10.4)
            logger.error(
                f"Local transcription failed | "
                f"audio_shape={audio_data.shape} | "
                f"sample_rate={sample_rate} | "
                f"language={language} | "
                f"model_size={self.model_size} | "
                f"device={self.device} | "
                f"error_type={type(e).__name__} | "
                f"error={str(e)}"
            )
            raise ASRException(
                f"faster-whisper transcription failed: {e}",
                details={
                    "model_size": self.model_size,
                    "device": self.device,
                    "language": language,
                    "error_type": type(e).__name__
                }
            )



    async def transcribe_stream(
        self, audio_data: np.ndarray, sample_rate: int = 16000
    ) -> StreamingASRResult:
        """
        Transcribe PCM audio data from streaming input.

        This method accepts float32 numpy arrays directly and passes them
        to the Whisper model without any format conversion or temporary files.

        Args:
            audio_data: Float32 numpy array of audio samples in range [-1.0, 1.0]
            sample_rate: Sample rate of the audio (default: 16000 Hz)

        Returns:
            StreamingASRResult with transcript and metadata
        """
        if audio_data is None or len(audio_data) == 0:
            raise ASRException("No audio data provided")

        logger.info(
            f"Transcribing stream | "
            f"samples={len(audio_data)} | "
            f"duration={len(audio_data) / sample_rate:.2f}s | "
            f"sample_rate={sample_rate}Hz"
        )

        try:
            # Pass numpy array directly to faster-whisper (no temporary files needed)
            result = await self._transcribe_local(audio_data, sample_rate)
            return result

        except Exception as e:
            # Comprehensive error logging with audio metadata (Requirement 10.3, 10.4)
            logger.error(
                f"Stream transcription failed | "
                f"samples={len(audio_data)} | "
                f"sample_rate={sample_rate} | "
                f"error_type={type(e).__name__} | "
                f"error={str(e)}"
            )
            raise ASRException(
                f"Failed to transcribe audio stream: {e}",
                details={
                    "sample_count": len(audio_data),
                    "sample_rate": sample_rate,
                    "error_type": type(e).__name__
                }
            )

