"""Voice Mode Handler for continuous ASR voice mode.

This module provides the VoiceModeHandler class that integrates AudioPipeline
with the ASR service and conversation pipeline. It receives raw PCM audio bytes
via WebSocket binary frames, accumulates them until silence is detected, transcribes
the audio, and passes the transcript to the conversation pipeline for LLM processing.

Architecture:
    WebSocket (Binary Frames) → VoiceModeHandler → AudioPipeline → ASR → ConversationPipeline
"""

from __future__ import annotations

import time
from collections import deque
from typing import TYPE_CHECKING

from loguru import logger

from app.infrastructure.asr.audio_pipeline import (
    AudioPipeline,
    BufferOverflowError,
    BufferTimeoutError,
    ChunkSizeError,
)
from app.domain.voice.ports import StreamingASRService

if TYPE_CHECKING:
    from fastapi import WebSocket
    from app.application.voice.handle_voice_turn import ConversationPipeline


class RateLimitError(Exception):
    """Raised when rate limit for audio chunks is exceeded."""

    pass


class VoiceModeHandler:
    """Handles voice mode audio processing for a WebSocket session.

    This class manages the flow of raw PCM audio data from WebSocket binary frames
    through ASR to the conversation pipeline. It maintains session-specific audio
    buffers and coordinates the transcription and conversation processing.

    Attributes:
        websocket: WebSocket connection for sending messages to client
        session_id: Unique session identifier
        asr_service: ASR service for transcribing audio
        conversation_pipeline: Pipeline for processing transcripts through LLM and TTS
        audio_pipeline: Pipeline for accumulating PCM audio chunks
    """

    def __init__(
        self,
        websocket: WebSocket,
        session_id: str,
        asr_service: StreamingASRService,
        conversation_pipeline: ConversationPipeline,
        max_buffer_size: int = 10 * 1024 * 1024,
        max_chunk_size: int = 1 * 1024 * 1024,
        buffer_timeout: float = 30.0,
        max_buffer_duration: float = 25.0,
        rate_limit_chunks: int = 100,
        rate_limit_window: float = 1.0,
    ):
        """Initialize voice mode handler.

        Args:
            websocket: WebSocket connection for this session
            session_id: Unique session identifier (UUID)
            asr_service: ASR service instance for transcription
            conversation_pipeline: Conversation pipeline instance
            max_buffer_size: Maximum audio buffer size in bytes (default 10MB)
            max_chunk_size: Maximum single chunk size in bytes (default 1MB)
            buffer_timeout: Maximum buffer accumulation time in seconds (default 30s)
            max_buffer_duration: Proactive flush threshold in seconds (default 25s)
            rate_limit_chunks: Maximum chunks allowed per rate limit window (default 100)
            rate_limit_window: Rate limit time window in seconds (default 1.0s)

        Preconditions:
            - websocket is connected and active
            - session_id is valid UUID string
            - asr_service is initialized and ready
            - conversation_pipeline is initialized
            - max_buffer_size is positive integer
            - rate_limit_chunks is positive integer
            - rate_limit_window is positive float

        Postconditions:
            - Handler is ready to receive audio chunks
            - Audio buffer is initialized with size limit
            - Rate limiting is configured and active
            - All services are ready for processing
        """
        self.websocket = websocket
        self.session_id = session_id
        self.asr_service = asr_service
        self.conversation_pipeline = conversation_pipeline
        self.audio_pipeline = AudioPipeline(
            max_buffer_size=max_buffer_size,
            max_chunk_size=max_chunk_size,
            buffer_timeout=buffer_timeout,
            max_buffer_duration=max_buffer_duration,
        )

        # Rate limiting configuration
        self.rate_limit_chunks = rate_limit_chunks
        self.rate_limit_window = rate_limit_window
        self._chunk_timestamps: deque = deque()

        logger.info(
            f"VoiceModeHandler initialized | "
            f"session={session_id} | "
            f"max_buffer_size={max_buffer_size} | "
            f"max_chunk_size={max_chunk_size} | "
            f"buffer_timeout={buffer_timeout}s | "
            f"rate_limit={rate_limit_chunks} chunks/{rate_limit_window}s"
        )

    def _check_rate_limit(self) -> None:
        """Check if rate limit is exceeded for audio chunks.

        Uses a sliding window approach to track chunk timestamps and enforce
        the rate limit. Removes timestamps outside the current window.

        Raises:
            RateLimitError: If rate limit is exceeded

        Postconditions:
            - Old timestamps outside window are removed
            - Current timestamp is added to tracking
            - RateLimitError raised if limit exceeded
        """
        current_time = time.time()

        # Remove timestamps outside the current window
        while (
            self._chunk_timestamps
            and current_time - self._chunk_timestamps[0] > self.rate_limit_window
        ):
            self._chunk_timestamps.popleft()

        # Check if adding this chunk would exceed the limit
        if len(self._chunk_timestamps) >= self.rate_limit_chunks:
            raise RateLimitError(
                f"Rate limit exceeded: {self.rate_limit_chunks} chunks per "
                f"{self.rate_limit_window} seconds"
            )

        # Add current timestamp
        self._chunk_timestamps.append(current_time)

    async def handle_audio_chunk(self, pcm_bytes: bytes, is_final: bool = False) -> None:
        """Handle incoming PCM audio chunk from client binary frame.

        Receives raw PCM audio bytes from WebSocket binary frames, validates them,
        checks rate limits, and adds them to the buffer. Triggers ASR processing when
        buffer should be processed (either VAD silence detection or proactive duration-based flush).

        Args:
            pcm_bytes: Raw PCM audio bytes (16-bit signed integer, little-endian, 16kHz mono)
            is_final: Boolean indicating VAD detected silence (default False)

        Preconditions:
            - pcm_bytes is valid bytes object
            - audio pipeline has not exceeded size limit
            - rate limit has not been exceeded

        Postconditions:
            - PCM chunk is added to buffer if valid and within limits
            - If should_process() returns True, ASR processing is triggered
            - Error message is sent to client if validation fails
            - Buffer is cleared after successful transcription

        Raises:
            BufferOverflowError: If adding chunk would exceed max buffer size
            ChunkSizeError: If chunk size exceeds max chunk size
            BufferTimeoutError: If buffer accumulation exceeds timeout
            RateLimitError: If rate limit is exceeded
            ValueError: If pcm_bytes validation fails
        """
        try:
            # Check rate limit before processing
            self._check_rate_limit()

            # Validate PCM bytes
            if not isinstance(pcm_bytes, bytes):
                raise ValueError("Audio data must be bytes")

            if len(pcm_bytes) == 0:
                raise ValueError("Audio data cannot be empty")

            # Add PCM chunk to pipeline
            self.audio_pipeline.add_pcm_chunk(pcm_bytes, is_final=is_final)

            logger.debug(
                f"PCM chunk added | "
                f"session={self.session_id} | "
                f"is_final={is_final} | "
                f"buffer_size={self.audio_pipeline.get_buffer_size()} bytes"
            )

            # Process accumulated audio if buffer should be processed
            # This triggers on either: VAD silence detection (is_final) or proactive duration flush
            if self.audio_pipeline.should_process():
                await self.process_accumulated_audio()

        except RateLimitError as e:
            logger.warning(f"Rate limit exceeded | session={self.session_id} | error={str(e)}")
            await self.websocket.send_json(
                {
                    "type": "error",
                    "code": "RATE_LIMIT_EXCEEDED",
                    "message": f"Too many audio chunks. Please slow down. ({str(e)})",
                    "session_id": self.session_id,
                }
            )

        except ChunkSizeError as e:
            logger.error(f"Chunk size exceeded | session={self.session_id} | error={str(e)}")
            await self.websocket.send_json(
                {
                    "type": "error",
                    "code": "CHUNK_SIZE_EXCEEDED",
                    "message": "Audio chunk is too large. Please use smaller chunks.",
                    "session_id": self.session_id,
                }
            )

        except BufferTimeoutError as e:
            # Comprehensive error logging for buffer timeout with session info (Requirement 9.2, 9.3)
            logger.error(
                f"Buffer timeout | "
                f"session={self.session_id} | "
                f"buffer_size={self.audio_pipeline.get_buffer_size():,}B | "
                f"timeout={self.audio_pipeline.buffer_timeout}s | "
                f"error={str(e)}"
            )
            await self.websocket.send_json(
                {
                    "type": "error",
                    "code": "BUFFER_TIMEOUT",
                    "message": "Audio buffer timeout. Please speak in shorter segments.",
                    "session_id": self.session_id,
                }
            )
            # Clear buffer to recover
            self.audio_pipeline.clear_buffer()

        except BufferOverflowError as e:
            # Comprehensive error logging for buffer overflow with session info (Requirement 9.2, 9.3)
            logger.error(
                f"Buffer overflow | "
                f"session={self.session_id} | "
                f"buffer_size={self.audio_pipeline.get_buffer_size():,}B | "
                f"max_buffer_size={self.audio_pipeline.max_buffer_size:,}B | "
                f"error={str(e)}"
            )
            await self.websocket.send_json(
                {
                    "type": "error",
                    "code": "BUFFER_OVERFLOW",
                    "message": "Audio buffer exceeded maximum size. Please speak in shorter segments.",
                    "session_id": self.session_id,
                }
            )
            # Clear buffer to recover
            self.audio_pipeline.clear_buffer()

        except ValueError as e:
            logger.error(f"Invalid PCM audio data | session={self.session_id} | error={str(e)}")
            await self.websocket.send_json(
                {
                    "type": "error",
                    "code": "INVALID_AUDIO_DATA",
                    "message": f"Invalid PCM audio data: {str(e)}",
                    "session_id": self.session_id,
                }
            )

        except Exception as e:
            logger.exception(f"Unexpected error handling audio chunk | session={self.session_id}")
            await self.websocket.send_json(
                {
                    "type": "error",
                    "code": "AUDIO_PROCESSING_ERROR",
                    "message": "An unexpected error occurred while processing audio.",
                    "session_id": self.session_id,
                }
            )

    async def process_accumulated_audio(self) -> None:
        """Process buffered PCM audio through ASR and conversation pipeline.

        Retrieves accumulated PCM audio from buffer, converts it to float32 numpy array,
        transcribes it using the ASR service, sends the transcript to the client, and
        passes it to the conversation pipeline for LLM processing.

        Preconditions:
            - Audio pipeline contains at least one chunk
            - should_process() returns True (either VAD silence or duration threshold)
            - ASR service is initialized and ready

        Postconditions:
            - PCM audio is converted to float32 numpy array
            - Audio is transcribed to text
            - Transcript is sent to client via WebSocket
            - Transcript is passed to conversation pipeline
            - Audio buffer is cleared
            - If transcription fails, error is sent to client and buffer is cleared
        """
        try:
            # Get buffer size for logging
            total_size = self.audio_pipeline.get_buffer_size()

            if total_size == 0:
                logger.warning(f"No audio data to process | session={self.session_id}")
                self.audio_pipeline.clear_buffer()
                return

            logger.info(
                f"Processing accumulated PCM audio | "
                f"session={self.session_id} | "
                f"total_size={total_size} bytes"
            )

            # Convert PCM buffer to float32 numpy array for ASR
            audio_data = self.audio_pipeline.get_audio_for_asr()

            # Transcribe audio using ASR service (now accepts numpy array directly)
            result = await self.asr_service.transcribe_stream(
                audio_chunks=audio_data
            )

            logger.info(
                f"Transcription complete | "
                f"session={self.session_id} | "
                f"transcript_length={len(result.transcript)} | "
                f"confidence={result.confidence:.2f} | "
                f"language={result.language}"
            )

            # Send transcript to client
            await self.send_transcript(
                text=result.transcript,
                confidence=result.confidence,
                language=result.language,
            )

            # Clear buffer after successful transcription
            self.audio_pipeline.clear_buffer()

            # Pass transcript to conversation pipeline if not empty
            if result.transcript.strip():
                # Trigger conversation pipeline with the transcript
                # The pipeline will handle LLM processing and TTS generation
                logger.info(
                    f"Triggering conversation pipeline | "
                    f"session={self.session_id} | "
                    f"transcript='{result.transcript[:60]}'"
                )
                # Note: The conversation pipeline processing will be handled by the
                # WebSocket handler which will receive the transcript message and
                # call process_text() or process_message() as appropriate
            else:
                logger.warning(f"Empty transcript received | session={self.session_id}")

        except Exception as e:
            # Comprehensive error logging for transcription failures (Requirement 10.3, 10.4)
            logger.exception(
                f"Transcription failed | "
                f"session={self.session_id} | "
                f"total_size={total_size:,}B | "
                f"error_type={type(e).__name__}"
            )

            # Send detailed error message to client
            error_message = {
                "type": "error",
                "code": "TRANSCRIPTION_FAILED",
                "message": "Failed to transcribe audio. Please try again.",
                "session_id": self.session_id,
                "details": {},  # Always include details field
            }

            # Include error details if it's an ASRException with details (Requirement 13.5)
            if hasattr(e, "details") and e.details:
                error_message["details"] = e.details

                # If it's a format conversion error, provide supported formats
                if "supported_formats" in e.details:
                    error_message["message"] = (
                        f"Audio format not supported. Supported formats: "
                        f"{', '.join(e.details['supported_formats'])}"
                    )
            else:
                # For generic exceptions, include error type and message
                error_message["details"] = {"error_type": type(e).__name__, "error": str(e)}

            await self.websocket.send_json(error_message)

            # Clear buffer to prepare for next attempt
            self.audio_pipeline.clear_buffer()

    async def send_transcript(
        self,
        text: str,
        confidence: float = 1.0,
        language: str = "en",
    ) -> None:
        """Send transcript message to client via WebSocket.

        Args:
            text: Transcribed text from ASR
            confidence: Confidence score from ASR (0.0 to 1.0)
            language: Detected language code (e.g., "en", "ar")

        Preconditions:
            - text is non-empty string
            - confidence is between 0.0 and 1.0
            - language is valid ISO 639-1 code
            - WebSocket connection is active

        Postconditions:
            - Transcript message is sent to client
            - Message includes session_id, text, confidence, language, and is_final flag
        """
        try:
            await self.websocket.send_json(
                {
                    "type": "transcript",
                    "session_id": self.session_id,
                    "text": text,
                    "confidence": confidence,
                    "language": language,
                    "is_final": True,
                }
            )

            logger.debug(
                f"Transcript sent | "
                f"session={self.session_id} | "
                f"text_length={len(text)} | "
                f"confidence={confidence:.2f}"
            )

        except Exception as e:
            logger.exception(f"Failed to send transcript | session={self.session_id}")
            # Don't raise - this is a best-effort notification
