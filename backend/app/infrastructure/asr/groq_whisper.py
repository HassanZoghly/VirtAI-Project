"""
ASR Provider using Groq Whisper API.

Model options (Groq):
    - whisper-large-v3           → most accurate, slower
    - whisper-large-v3-turbo     → fast + accurate  ← our default
    - distil-whisper-large-v3-en → English only, fastest
"""

from __future__ import annotations

import io
import math
import time
import wave

import numpy as np
from groq import APIConnectionError, APIStatusError, APITimeoutError, AsyncGroq
from loguru import logger
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.domain.voice.entities import (
    ASRResult,
    ASRSegment,
    StreamingASRResult,
    WordTimestamp,
)
from app.domain.voice.ports import BaseASRProvider, StreamingASRService
from app.shared.config import get_settings
from app.shared.errors import ASRException

settings = get_settings()


# ── Simple Audio Validation (replaces audio_validator.py) ────────────────────
MAX_AUDIO_SIZE_BYTES = 24 * 1024 * 1024  # 24 MB
MIN_AUDIO_SIZE_BYTES = 1024  # 1 KB


def validate_audio_size(audio_bytes: bytes) -> None:
    """Validates audio size is within acceptable range."""
    size = len(audio_bytes)
    if size < MIN_AUDIO_SIZE_BYTES:
        raise ASRException(
            f"Audio too small ({size} bytes). Minimum is {MIN_AUDIO_SIZE_BYTES} bytes."
        )
    if size > MAX_AUDIO_SIZE_BYTES:
        raise ASRException(
            f"Audio too large ({size:,} bytes). Maximum is {MAX_AUDIO_SIZE_BYTES:,} bytes."
        )


def _field(source, name: str, default=None):
    if isinstance(source, dict):
        return source.get(name, default)
    return getattr(source, name, default)


def _float_value(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _confidence_value(value, default: float = 1.0) -> float:
    return max(0.0, min(1.0, _float_value(value, default)))


class GroqWhisperASR(BaseASRProvider, StreamingASRService):
    """
    ASR using Groq's Whisper API.

    Why Groq for ASR?
    - Extremely fast inference (fastest Whisper available)
    - Supports multiple languages including English and Arabic
    - verbose_json gives us segments + word timestamps
    - Same API key as LLM (no extra cost setup)
    """

    def __init__(
        self,
        model: str | None = None,
        language: str | None = None,
        api_key: str | None = None,
    ):
        self.model = model or settings.ASR_MODEL
        self.language = language or settings.ASR_LANGUAGE
        self._client = AsyncGroq(api_key=api_key or settings.GROQ_API_KEY)
        logger.info(f"GroqWhisperASR initialized | model={self.model} | language={self.language}")

    # ── Private Helpers ───────────────────────────────────────────────────────
    def _parse_word_timestamps(self, raw_words: list[dict]) -> list[WordTimestamp]:
        """
        Parses word-level timestamps from Groq verbose_json response.
        Groq word format:
        {
            "word": "hello",
            "start": 0.5,    ← seconds
            "end": 0.9
        }
        """
        words = []
        for w in raw_words:
            try:
                words.append(
                    WordTimestamp(
                        word=str(_field(w, "word", "")).strip(),
                        start_ms=_float_value(_field(w, "start", 0)) * 1000,
                        end_ms=_float_value(_field(w, "end", 0)) * 1000,
                        confidence=_confidence_value(_field(w, "probability", 1.0)),
                    )
                )
            except (ValueError, TypeError) as e:
                logger.warning(f"Failed to parse word timestamp: {w} | {e}")
        return words

    def _extract_word_probabilities(self, raw_words: list[dict]) -> list[float]:
        probabilities = []
        for word in raw_words:
            probability = _field(word, "probability", None)
            if probability is not None:
                probabilities.append(_confidence_value(probability))
        return probabilities

    def _estimate_segment_confidence(
        self,
        avg_logprob: float,
        no_speech_prob: float,
        word_probabilities: list[float],
    ) -> float:
        if word_probabilities:
            base_confidence = sum(word_probabilities) / len(word_probabilities)
        else:
            # Whisper avg_logprob is not a calibrated user-facing confidence score.
            # A sigmoid keeps clear short utterances from being reported as false lows.
            bounded_logprob = max(-5.0, min(0.0, avg_logprob))
            base_confidence = 1.0 / (1.0 + math.exp(-3.0 * (bounded_logprob + 1.25)))

        speech_penalty = 1.0 - (_confidence_value(no_speech_prob, default=0.0) * 0.65)
        return _confidence_value(base_confidence * speech_penalty, default=0.0)

    def _parse_segments(self, raw_segments: list[dict]) -> list[ASRSegment]:
        """
        Parses segments from Groq verbose_json response.

        Groq segment format:
        {
            "id": 0,
            "text": "Hello how are you",
            "start": 0.0,
            "end": 2.5,
            "words": [...],
            "avg_logprob": -0.2,
            "no_speech_prob": 0.01
        }
        """
        segments = []
        for seg in raw_segments:
            try:
                # Skip segments that are likely silence/noise
                no_speech_prob = _float_value(_field(seg, "no_speech_prob", 0))
                if no_speech_prob > 0.8:
                    logger.debug(
                        f"Skipping likely-silence segment | "
                        f"no_speech_prob={no_speech_prob:.2f} | "
                        f"text='{_field(seg, 'text', '')}'"
                    )
                    continue

                # Parse word timestamps if available
                raw_words = _field(seg, "words", []) or []
                words = self._parse_word_timestamps(raw_words)

                avg_logprob = _float_value(_field(seg, "avg_logprob", -0.5), -0.5)
                confidence = self._estimate_segment_confidence(
                    avg_logprob=avg_logprob,
                    no_speech_prob=no_speech_prob,
                    word_probabilities=self._extract_word_probabilities(raw_words),
                )
                segments.append(
                    ASRSegment(
                        text=str(_field(seg, "text", "")).strip(),
                        start_ms=_float_value(_field(seg, "start", 0)) * 1000,
                        end_ms=_float_value(_field(seg, "end", 0)) * 1000,
                        words=words,
                        confidence=confidence,
                    )
                )
            except (ValueError, TypeError, KeyError) as e:
                logger.warning(f"Failed to parse ASR segment: {seg} | {e}")
        return segments

    def _build_asr_result(
        self,
        response,
        duration_ms: float,
    ) -> ASRResult:
        """
        Builds ASRResult from Groq API response object.
        Handles both verbose_json and plain text responses.
        """
        # Full transcript
        transcript = str(_field(response, "text", "")).strip()

        # Segments (only in verbose_json)
        raw_segments = _field(response, "segments", None) or []
        segments = self._parse_segments(raw_segments)

        # Detected language
        detected_language = _field(response, "language", self.language) or self.language

        # Overall confidence (average of segments, weighted by recognized words)
        if segments:
            weights = [len(segment.words) or max(1, len(segment.text.split())) for segment in segments]
            avg_confidence = sum(
                segment.confidence * weight for segment, weight in zip(segments, weights)
            ) / sum(weights)
        else:
            avg_confidence = 1.0
        return ASRResult(
            transcript=transcript,
            segments=segments,
            language=detected_language,
            duration_ms=duration_ms,
            confidence=avg_confidence,
        )

    # ── Public Methods ────────────────────────────────────────────────────────
    @retry(
        retry=retry_if_exception_type((APIStatusError, APITimeoutError, APIConnectionError)),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        stop=stop_after_attempt(3),
        reraise=True,
    )
    async def _call_groq_api(self, audio_file: io.BytesIO, lang: str):
        """Helper to call Groq API with automatic retries for transient errors."""
        audio_file.seek(0)
        return await self._client.audio.transcriptions.create(
            model=self.model,
            file=audio_file,
            language=lang,
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )

    async def transcribe(
        self,
        audio_bytes: bytes,
        audio_format: str = "webm",
        language: str | None = None,
    ) -> ASRResult:
        """
        Transcribes audio to text using Groq Whisper.

        Args:
            audio_bytes : raw audio data from the WebSocket
            audio_format: audio format (webm, wav, mp3, etc.)
            language    : override language (None → use instance default)

        Returns:
            ASRResult with transcript + segments + word timestamps
        """

        # ── Validate ─────────────────────────────────────────────────────────
        validate_audio_size(audio_bytes)
        lang = language or self.language

        logger.info(
            f"ASR transcribe start | "
            f"size={len(audio_bytes):,}B | "
            f"format={audio_format} | "
            f"language={lang} | "
            f"model={self.model}"
        )
        start_time = time.perf_counter()

        # ── Call Groq Whisper ─────────────────────────────────────────────────
        try:
            # Groq SDK expects a file-like object with a name
            audio_file = io.BytesIO(audio_bytes)
            audio_file.name = f"audio.{audio_format}"

            response = await self._call_groq_api(audio_file, lang)
        except Exception as e:
            logger.error(f"Groq ASR API call failed: {e}")
            raise ASRException(f"ASR transcription failed: {e!s}")

        # ── Parse Response ────────────────────────────────────────────────────
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        result = self._build_asr_result(
            response=response,
            duration_ms=elapsed_ms,
        )

        # ── Guard: Empty Transcript ───────────────────────────────────────────
        if result.is_empty:
            raise ASRException("ASR returned empty transcript — no speech detected")
        logger.success(
            f"ASR done | "
            f"elapsed={elapsed_ms:.0f}ms | "
            f"words={result.word_count} | "
            f"segments={len(result.segments)} | "
            f"lang={result.language} | "
            f"confidence={result.confidence:.2f} | "
            f"transcript='{result.transcript[:60]}...'"
        )
        return result

    async def transcribe_chunks(
        self,
        audio_chunks: list[bytes],
        audio_format: str = "webm",
        language: str | None = None,
    ) -> ASRResult:
        """
        Convenience method: joins chunks then transcribes.
        Used by the WebSocket handler which collects chunks incrementally.

        Args:
            audio_chunks: list of raw audio bytes received over WebSocket
            audio_format: declared format
            language    : override language
        """
        if not audio_chunks:
            raise ASRException("No audio chunks provided")

        combined = b"".join(audio_chunks)
        logger.debug(f"Joining {len(audio_chunks)} chunks → {len(combined):,} bytes total")
        return await self.transcribe(combined, audio_format, language)

    async def transcribe_stream(
        self,
        audio_data: np.ndarray,
        sample_rate: int = 16000,
    ) -> StreamingASRResult:
        """
        Streaming ASR: accepts float32 numpy audio, converts to WAV,
        and transcribes via Groq Whisper API.

        Args:
            audio_data: float32 numpy array in [-1.0, 1.0]
            sample_rate: sample rate in Hz (default 16000)
        """
        # Convert float32 [-1,1] → int16 PCM
        pcm_int16 = (audio_data * 32767).clip(-32768, 32767).astype(np.int16)

        # Write WAV into memory buffer
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm_int16.tobytes())
        wav_bytes = buf.getvalue()

        result = await self.transcribe(wav_bytes, audio_format="wav")
        return StreamingASRResult(
            transcript=result.transcript,
            confidence=result.confidence,
            language=result.language,
        )

    async def is_available(self) -> bool:
        """
        Quick health check against Groq API.
        Sends a tiny silent WAV to verify connectivity.
        """
        try:
            # Minimal valid WAV (44-byte header, no data)
            silent_wav = (
                b"RIFF$\x00\x00\x00WAVEfmt "
                b"\x10\x00\x00\x00\x01\x00\x01\x00"
                b"\x80>\x00\x00\x00}\x00\x00\x02\x00"
                b"\x10\x00data\x00\x00\x00\x00"
            )
            audio_file = io.BytesIO(silent_wav)
            audio_file.name = "health_check.wav"

            await self._client.audio.transcriptions.create(
                model=self.model,
                file=audio_file,
                response_format="text",
            )
            return True

        except Exception as e:
            logger.warning(f"ASR health check failed: {e}")
            return False
