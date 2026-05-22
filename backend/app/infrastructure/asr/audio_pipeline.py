"""Unified audio processing module for PCM audio pipeline.

This module provides the AudioPipeline class that accumulates raw PCM audio bytes
from WebSocket binary frames, integrates with VAD for silence detection, and
prepares audio data for ASR processing. It replaces the WebM-based buffer_manager
with a simpler PCM-based approach that eliminates container parsing overhead.

Key features:
- PCM buffer accumulation using bytearray for efficient byte concatenation
- Binary frame handler for raw PCM bytes from WebSocket
- Direct PCM → Float32 conversion without ffmpeg/pydub
- VAD integration for silence-triggered buffer flush
- Timeout-based fallback flush for continuous speech
- Buffer size limits to prevent memory exhaustion
"""

import time

import numpy as np


class BufferOverflowError(Exception):
    """Raised when audio buffer exceeds maximum allowed size."""

    pass


class BufferTimeoutError(Exception):
    """Raised when audio buffer accumulation exceeds timeout duration."""

    pass


class ChunkSizeError(Exception):
    """Raised when a single audio chunk exceeds maximum allowed size."""

    pass


class AudioPipeline:
    """Manages PCM audio buffer accumulation and ASR input preparation.

    This class accumulates raw PCM audio bytes received from WebSocket binary frames
    until a final chunk (is_final=True) is received, indicating VAD detected silence,
    or until the buffer duration reaches the proactive flush threshold. It converts
    the accumulated PCM buffer to float32 numpy array for ASR input.

    The buffer uses two trigger mechanisms for ASR processing:
    1. Primary: VAD-based silence detection (is_final=True) - immediate processing
    2. Fallback: Proactive duration-based flush (max_buffer_duration) - prevents
       timeout during continuous speech without silence pauses

    PCM Format:
    - Sample rate: 16kHz
    - Channels: mono (1 channel)
    - Bit depth: 16-bit signed integer (Int16)
    - Byte order: little-endian

    Attributes:
        max_buffer_size: Maximum total buffer size in bytes (default 10MB)
        max_chunk_size: Maximum size for a single chunk in bytes (default 1MB)
        buffer_timeout: Maximum time to accumulate audio in seconds (default 30s)
        max_buffer_duration: Proactive flush threshold in seconds (default 25s)
    """

    def __init__(
        self,
        max_buffer_size: int = 10 * 1024 * 1024,
        max_chunk_size: int = 1 * 1024 * 1024,
        buffer_timeout: float = 30.0,
        max_buffer_duration: float = 25.0,
    ):
        """Initialize audio pipeline.

        Args:
            max_buffer_size: Maximum buffer size in bytes (default 10MB)
            max_chunk_size: Maximum single chunk size in bytes (default 1MB)
            buffer_timeout: Maximum accumulation time in seconds (default 30s)
            max_buffer_duration: Proactive flush threshold in seconds (default 25s)

        Raises:
            ValueError: If max_buffer_size, max_chunk_size, or buffer_timeout is not positive
            ValueError: If max_buffer_duration >= buffer_timeout
        """
        if max_buffer_size <= 0:
            raise ValueError("max_buffer_size must be positive")
        if max_chunk_size <= 0:
            raise ValueError("max_chunk_size must be positive")
        if buffer_timeout <= 0:
            raise ValueError("buffer_timeout must be positive")
        if max_buffer_duration >= buffer_timeout:
            raise ValueError("max_buffer_duration must be less than buffer_timeout")

        self.max_buffer_size = max_buffer_size
        self.max_chunk_size = max_chunk_size
        self.buffer_timeout = buffer_timeout
        self.max_buffer_duration = max_buffer_duration
        self._buffer: bytearray = bytearray()
        self._is_final: bool = False
        self._started_at: float | None = None
        self._last_chunk_at: float | None = None

    def add_pcm_chunk(self, pcm_bytes: bytes, is_final: bool = False) -> None:
        """Append raw PCM bytes to buffer.

        Accumulates raw PCM audio bytes from WebSocket binary frames. Validates
        chunk size and buffer limits. Updates VAD final flag for silence detection.

        Args:
            pcm_bytes: Raw PCM audio bytes (16-bit signed integer, little-endian)
            is_final: True when VAD detects silence, indicating end of speech segment

        Raises:
            BufferOverflowError: If adding chunk would exceed max_buffer_size
            ChunkSizeError: If chunk size exceeds max_chunk_size
            BufferTimeoutError: If buffer accumulation exceeds timeout
            ValueError: If pcm_bytes is empty or invalid
        """
        current_time = time.time()

        # Initialize timestamps on first chunk
        if self._started_at is None:
            self._started_at = current_time

        # Check buffer timeout (but allow if buffer is ready to process)
        if self._started_at is not None:
            elapsed = current_time - self._started_at
            if elapsed > self.buffer_timeout:
                # Only raise timeout if buffer is not ready to process
                if not (self._is_final or elapsed >= self.max_buffer_duration):
                    raise BufferTimeoutError(
                        f"Buffer accumulation exceeded timeout of {self.buffer_timeout} seconds "
                        f"(elapsed: {elapsed:.1f} seconds)"
                    )

        # Validate PCM bytes
        if not pcm_bytes:
            raise ValueError("pcm_bytes cannot be empty")

        if not isinstance(pcm_bytes, bytes):
            raise ValueError("pcm_bytes must be bytes object")

        chunk_size = len(pcm_bytes)

        # Check single chunk size limit
        if chunk_size > self.max_chunk_size:
            raise ChunkSizeError(
                f"Chunk size {chunk_size} bytes exceeds maximum allowed "
                f"chunk size of {self.max_chunk_size} bytes"
            )

        # Check if adding this chunk would exceed the buffer limit
        if len(self._buffer) + chunk_size > self.max_buffer_size:
            raise BufferOverflowError(
                f"Adding chunk of size {chunk_size} bytes would exceed "
                f"max_buffer_size of {self.max_buffer_size} bytes "
                f"(current size: {len(self._buffer)} bytes)"
            )

        # Add chunk to buffer (simple byte concatenation - safe for PCM)
        self._buffer.extend(pcm_bytes)
        self._last_chunk_at = current_time

        # Update final flag
        if is_final:
            self._is_final = True

    def should_process(self) -> bool:
        """Check VAD flag or timeout threshold.

        Returns True when VAD detects silence (is_final=True) or when buffer
        duration reaches the proactive flush threshold. This ensures audio is
        processed even during continuous speech without silence pauses.

        The is_final flag (VAD-based silence detection) is checked first as the
        primary trigger. Buffer duration check serves as a fallback mechanism.

        Returns:
            True if buffer is ready for processing, False otherwise
        """
        # Primary trigger: VAD detected silence
        if self._is_final:
            return True

        # Fallback trigger: Buffer duration reached proactive flush threshold
        if self._started_at is not None:
            elapsed = time.time() - self._started_at
            if elapsed >= self.max_buffer_duration:
                return True

        return False

    def get_audio_for_asr(self) -> np.ndarray:
        """Convert PCM buffer to float32 numpy array.

        Converts the accumulated PCM buffer (Int16 bytes) to a float32 numpy array
        in the range [-1.0, 1.0] for ASR model input. This conversion is done
        directly without ffmpeg or pydub.

        Returns:
            numpy.ndarray: Float32 audio samples in range [-1.0, 1.0]

        Raises:
            ValueError: If buffer is empty or has invalid size (not multiple of 2)
        """
        if len(self._buffer) == 0:
            raise ValueError("Cannot convert empty buffer to audio")

        # PCM Int16 requires 2 bytes per sample
        if len(self._buffer) % 2 != 0:
            raise ValueError(
                f"Buffer size {len(self._buffer)} is not a multiple of 2 "
                "(Int16 PCM requires 2 bytes per sample)"
            )

        return pcm_bytes_to_float32(bytes(self._buffer))

    def clear_buffer(self) -> None:
        """Reset buffer after transcription.

        Clears the PCM buffer and resets all state variables. This should be
        called after transcription is complete to free memory and prepare for
        the next speech segment.
        """
        self._buffer.clear()
        self._is_final = False
        self._started_at = None
        self._last_chunk_at = None

    def get_buffer_size(self) -> int:
        """Get total size of accumulated PCM buffer.

        Returns:
            Total size in bytes of accumulated PCM data
        """
        return len(self._buffer)


def pcm_bytes_to_float32(pcm_bytes: bytes) -> np.ndarray:
    """Int16 PCM → float32 conversion.

    Converts raw PCM bytes (16-bit signed integer, little-endian) to float32
    numpy array in the range [-1.0, 1.0]. This is the standard conversion for
    ASR model input.

    Conversion formula:
    - Int16 range: [-32768, 32767]
    - Float32 range: [-1.0, 1.0]
    - Conversion: float32 = int16 / 32768.0

    Args:
        pcm_bytes: Raw PCM bytes (Int16, little-endian)

    Returns:
        numpy.ndarray: Float32 audio samples in range [-1.0, 1.0]

    Raises:
        ValueError: If pcm_bytes is empty or has invalid size
    """
    if not pcm_bytes:
        raise ValueError("pcm_bytes cannot be empty")

    if len(pcm_bytes) % 2 != 0:
        raise ValueError(
            f"pcm_bytes size {len(pcm_bytes)} is not a multiple of 2 "
            "(Int16 PCM requires 2 bytes per sample)"
        )

    # Convert bytes to Int16 array
    int16_array = np.frombuffer(pcm_bytes, dtype=np.int16)

    # Convert Int16 to float32 in range [-1.0, 1.0]
    float32_array = int16_array.astype(np.float32) / 32768.0

    return float32_array
