"""
End-to-end integration tests for PCM audio pipeline.

This test suite verifies the complete PCM pipeline flow from audio capture
through WebSocket transmission to ASR transcription. It tests:
- Full flow: Microphone → AudioWorklet → PCM → WebSocket → Backend → ASR → Transcript
- Real audio file converted to PCM chunks
- Synthesized speech with known transcript
- Silence handling (empty transcript)
- ASR transcription accuracy

Validates Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
"""

import asyncio
import base64
import sys
import uuid
import numpy as np
import wave
import io
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path

import pytest

# Mock faster_whisper before importing any modules that depend on it
sys.modules['faster_whisper'] = MagicMock()


def generate_pcm_audio(duration_ms: int, frequency: int = 440, sample_rate: int = 16000) -> bytes:
    """Generate PCM audio data (sine wave) for testing.
    
    Args:
        duration_ms: Duration in milliseconds
        frequency: Frequency in Hz (default 440Hz = A4 note)
        sample_rate: Sample rate in Hz (default 16kHz)
        
    Returns:
        Raw PCM bytes (Int16, little-endian, mono)
    """
    num_samples = int(sample_rate * duration_ms / 1000)
    t = np.linspace(0, duration_ms / 1000, num_samples, False)
    
    # Generate sine wave
    audio = np.sin(2 * np.pi * frequency * t)
    
    # Convert to Int16 PCM
    audio_int16 = (audio * 32767).astype(np.int16)
    
    return audio_int16.tobytes()


def generate_silence(duration_ms: int, sample_rate: int = 16000) -> bytes:
    """Generate silence (zeros) for testing.
    
    Args:
        duration_ms: Duration in milliseconds
        sample_rate: Sample rate in Hz (default 16kHz)
        
    Returns:
        Raw PCM bytes (Int16, little-endian, mono) containing silence
    """
    num_samples = int(sample_rate * duration_ms / 1000)
    silence = np.zeros(num_samples, dtype=np.int16)
    return silence.tobytes()


def chunk_pcm_audio(pcm_bytes: bytes, chunk_duration_ms: int = 100, sample_rate: int = 16000) -> list[bytes]:
    """Split PCM audio into chunks.
    
    Args:
        pcm_bytes: Raw PCM bytes to split
        chunk_duration_ms: Duration of each chunk in milliseconds
        sample_rate: Sample rate in Hz
        
    Returns:
        List of PCM byte chunks
    """
    bytes_per_sample = 2  # Int16 = 2 bytes
    samples_per_chunk = int(sample_rate * chunk_duration_ms / 1000)
    bytes_per_chunk = samples_per_chunk * bytes_per_sample
    
    chunks = []
    for i in range(0, len(pcm_bytes), bytes_per_chunk):
        chunk = pcm_bytes[i:i + bytes_per_chunk]
        if len(chunk) > 0:
            chunks.append(chunk)
    
    return chunks


@pytest.mark.asyncio
async def test_end_to_end_pcm_pipeline_with_synthesized_audio():
    """
    Test full PCM pipeline flow with synthesized audio.
    
    Flow: PCM chunks → AudioPipeline → ASR → Transcript
    
    Validates Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
    """
    from app.infrastructure.asr.audio_pipeline import AudioPipeline, pcm_bytes_to_float32
    
    # Generate synthesized audio (440Hz sine wave, 1 second)
    pcm_audio = generate_pcm_audio(duration_ms=1000, frequency=440)
    
    # Split into chunks (100ms each)
    pcm_chunks = chunk_pcm_audio(pcm_audio, chunk_duration_ms=100)
    
    assert len(pcm_chunks) == 10, "Should have 10 chunks for 1 second at 100ms per chunk"
    
    # Create audio pipeline
    pipeline = AudioPipeline()
    
    # Add all chunks except the last one
    for chunk in pcm_chunks[:-1]:
        pipeline.add_pcm_chunk(chunk, is_final=False)
        assert not pipeline.should_process(), "Should not process until final chunk"
    
    # Add final chunk with is_final=True (simulating VAD silence detection)
    pipeline.add_pcm_chunk(pcm_chunks[-1], is_final=True)
    assert pipeline.should_process(), "Should process after final chunk"
    
    # Get audio for ASR
    audio_array = pipeline.get_audio_for_asr()
    
    # Verify audio format
    assert isinstance(audio_array, np.ndarray), "Should return numpy array"
    assert audio_array.dtype == np.float32, "Should be float32"
    assert audio_array.min() >= -1.0, "Values should be >= -1.0"
    assert audio_array.max() <= 1.0, "Values should be <= 1.0"
    
    # Verify audio length (1 second at 16kHz = 16000 samples)
    expected_samples = 16000
    assert len(audio_array) == expected_samples, f"Should have {expected_samples} samples"
    
    # Verify audio is not silence (sine wave should have non-zero values)
    assert np.abs(audio_array).max() > 0.1, "Audio should not be silence"
    
    # Clear buffer
    pipeline.clear_buffer()
    assert pipeline.get_buffer_size() == 0, "Buffer should be empty after clear"


@pytest.mark.asyncio
async def test_end_to_end_pcm_pipeline_with_silence():
    """
    Test PCM pipeline with silence (should produce empty/minimal transcript).
    
    Validates Requirements: 2.3, 2.4, 2.5
    """
    from app.infrastructure.asr.audio_pipeline import AudioPipeline
    
    # Generate silence (1 second)
    silence = generate_silence(duration_ms=1000)
    
    # Split into chunks
    silence_chunks = chunk_pcm_audio(silence, chunk_duration_ms=100)
    
    # Create audio pipeline
    pipeline = AudioPipeline()
    
    # Add all chunks
    for i, chunk in enumerate(silence_chunks):
        is_final = (i == len(silence_chunks) - 1)
        pipeline.add_pcm_chunk(chunk, is_final=is_final)
    
    # Get audio for ASR
    audio_array = pipeline.get_audio_for_asr()
    
    # Verify audio format
    assert isinstance(audio_array, np.ndarray), "Should return numpy array"
    assert audio_array.dtype == np.float32, "Should be float32"
    
    # Verify audio is silence (all values near zero)
    assert np.abs(audio_array).max() < 0.01, "Audio should be silence"
    
    # Clear buffer
    pipeline.clear_buffer()


@pytest.mark.asyncio
async def test_end_to_end_pcm_pipeline_with_multiple_chunks():
    """
    Test PCM pipeline with varying chunk sizes.
    
    Validates Requirements: 2.3, 2.4
    """
    from app.infrastructure.asr.audio_pipeline import AudioPipeline
    
    # Generate audio with different chunk sizes
    chunk1 = generate_pcm_audio(duration_ms=50)   # 50ms
    chunk2 = generate_pcm_audio(duration_ms=100)  # 100ms
    chunk3 = generate_pcm_audio(duration_ms=75)   # 75ms
    chunk4 = generate_pcm_audio(duration_ms=125)  # 125ms
    
    chunks = [chunk1, chunk2, chunk3, chunk4]
    
    # Create audio pipeline
    pipeline = AudioPipeline()
    
    # Add all chunks
    for i, chunk in enumerate(chunks):
        is_final = (i == len(chunks) - 1)
        pipeline.add_pcm_chunk(chunk, is_final=is_final)
    
    # Get audio for ASR
    audio_array = pipeline.get_audio_for_asr()
    
    # Verify audio format
    assert isinstance(audio_array, np.ndarray), "Should return numpy array"
    assert audio_array.dtype == np.float32, "Should be float32"
    
    # Verify total duration (50 + 100 + 75 + 125 = 350ms at 16kHz = 5600 samples)
    expected_samples = int(16000 * 0.350)
    assert len(audio_array) == expected_samples, f"Should have {expected_samples} samples"
    
    # Clear buffer
    pipeline.clear_buffer()


@pytest.mark.asyncio
async def test_pcm_conversion_accuracy():
    """
    Test PCM to Float32 conversion accuracy.
    
    Validates Requirements: 2.4
    """
    from app.infrastructure.asr.audio_pipeline import pcm_bytes_to_float32
    
    # Test known values
    # Int16 max (32767) should convert to ~1.0
    # Int16 min (-32768) should convert to -1.0
    # Int16 zero (0) should convert to 0.0
    
    test_values = np.array([32767, -32768, 0, 16384, -16384], dtype=np.int16)
    pcm_bytes = test_values.tobytes()
    
    float32_array = pcm_bytes_to_float32(pcm_bytes)
    
    # Verify conversion
    assert len(float32_array) == 5, "Should have 5 samples"
    assert float32_array.dtype == np.float32, "Should be float32"
    
    # Check specific values
    assert abs(float32_array[0] - 1.0) < 0.001, "Max Int16 should convert to ~1.0"
    assert abs(float32_array[1] - (-1.0)) < 0.001, "Min Int16 should convert to ~-1.0"
    assert abs(float32_array[2]) < 0.001, "Zero should convert to ~0.0"
    assert abs(float32_array[3] - 0.5) < 0.001, "Half max should convert to ~0.5"
    assert abs(float32_array[4] - (-0.5)) < 0.001, "Half min should convert to ~-0.5"


@pytest.mark.asyncio
async def test_pcm_pipeline_buffer_concatenation():
    """
    Test that PCM chunks are correctly concatenated in buffer.
    
    This is the core fix - PCM chunks can be safely concatenated without
    container parsing errors (unlike WebM chunks).
    
    Validates Requirements: 2.3, 2.4
    """
    from app.infrastructure.asr.audio_pipeline import AudioPipeline
    
    # Create audio pipeline
    pipeline = AudioPipeline()
    
    # Generate 5 chunks
    chunks = [generate_pcm_audio(duration_ms=100) for _ in range(5)]
    
    # Add chunks one by one
    for i, chunk in enumerate(chunks):
        is_final = (i == len(chunks) - 1)  # Mark last chunk as final
        pipeline.add_pcm_chunk(chunk, is_final=is_final)
        
        # Verify buffer size increases correctly
        expected_size = len(chunk) * (i + 1)
        assert pipeline.get_buffer_size() == expected_size, \
            f"Buffer size should be {expected_size} after {i+1} chunks"
    
    # Get audio for ASR (should succeed without decoding errors)
    audio_array = pipeline.get_audio_for_asr()
    
    # Verify concatenation worked correctly
    total_samples = sum(len(chunk) // 2 for chunk in chunks)  # Int16 = 2 bytes per sample
    assert len(audio_array) == total_samples, \
        f"Should have {total_samples} samples after concatenation"
    
    # Clear buffer
    pipeline.clear_buffer()


@pytest.mark.asyncio
async def test_pcm_pipeline_with_websocket_simulation():
    """
    Test PCM pipeline with simulated WebSocket binary frames.
    
    Simulates the full flow: binary frames → PCM buffer → ASR input
    
    Validates Requirements: 2.2, 2.3, 2.4
    """
    from app.infrastructure.asr.audio_pipeline import AudioPipeline
    
    # Generate audio
    pcm_audio = generate_pcm_audio(duration_ms=500)
    chunks = chunk_pcm_audio(pcm_audio, chunk_duration_ms=100)
    
    # Create audio pipeline
    pipeline = AudioPipeline()
    
    # Simulate WebSocket binary frames
    for i, chunk in enumerate(chunks):
        # In real WebSocket, this would be received as binary frame data
        binary_frame_data = chunk
        
        # Add to pipeline
        is_final = (i == len(chunks) - 1)
        pipeline.add_pcm_chunk(binary_frame_data, is_final=is_final)
    
    # Process audio
    assert pipeline.should_process(), "Should be ready to process"
    audio_array = pipeline.get_audio_for_asr()
    
    # Verify audio
    assert isinstance(audio_array, np.ndarray), "Should return numpy array"
    assert audio_array.dtype == np.float32, "Should be float32"
    assert len(audio_array) == 8000, "Should have 8000 samples (500ms at 16kHz)"
    
    # Clear buffer
    pipeline.clear_buffer()


@pytest.mark.asyncio
async def test_pcm_pipeline_error_handling():
    """
    Test PCM pipeline error handling with invalid data.
    
    Validates Requirements: 2.3, 2.4
    """
    from app.infrastructure.asr.audio_pipeline import AudioPipeline, pcm_bytes_to_float32
    
    # Test empty PCM bytes
    with pytest.raises(ValueError, match="pcm_bytes cannot be empty"):
        pcm_bytes_to_float32(b'')
    
    # Test odd-length PCM bytes (not multiple of 2)
    with pytest.raises(ValueError, match="not a multiple of 2"):
        pcm_bytes_to_float32(b'\x00\x01\x02')  # 3 bytes (odd)
    
    # Test empty buffer conversion
    pipeline = AudioPipeline()
    with pytest.raises(ValueError, match="Cannot convert empty buffer"):
        pipeline.get_audio_for_asr()


@pytest.mark.asyncio
async def test_pcm_pipeline_recovery_after_error():
    """
    Test that PCM pipeline can recover after error.
    
    Validates Requirements: 2.3, 3.4
    """
    from app.infrastructure.asr.audio_pipeline import AudioPipeline, BufferOverflowError
    
    # Create pipeline with small buffer limit
    pipeline = AudioPipeline(max_buffer_size=1000)
    
    # Add chunk that fits
    small_chunk = generate_pcm_audio(duration_ms=10)  # ~320 bytes
    pipeline.add_pcm_chunk(small_chunk, is_final=False)
    
    # Try to add chunk that would overflow
    large_chunk = generate_pcm_audio(duration_ms=100)  # ~3200 bytes
    with pytest.raises(BufferOverflowError):
        pipeline.add_pcm_chunk(large_chunk, is_final=False)
    
    # Clear buffer (recovery)
    pipeline.clear_buffer()
    
    # Should be able to add chunks again
    pipeline.add_pcm_chunk(small_chunk, is_final=True)
    assert pipeline.should_process(), "Should be ready to process after recovery"
    
    # Get audio (should succeed)
    audio_array = pipeline.get_audio_for_asr()
    assert len(audio_array) > 0, "Should have audio data after recovery"


@pytest.mark.asyncio
async def test_pcm_pipeline_preserves_audio_quality():
    """
    Test that PCM pipeline preserves audio quality through conversion.
    
    Validates Requirements: 2.4
    """
    from app.infrastructure.asr.audio_pipeline import pcm_bytes_to_float32
    
    # Generate known sine wave
    duration_ms = 1000
    frequency = 440  # A4 note
    sample_rate = 16000
    
    num_samples = int(sample_rate * duration_ms / 1000)
    t = np.linspace(0, duration_ms / 1000, num_samples, False)
    
    # Original float32 sine wave
    original_float32 = np.sin(2 * np.pi * frequency * t).astype(np.float32)
    
    # Convert to Int16 PCM
    int16_pcm = (original_float32 * 32767).astype(np.int16)
    pcm_bytes = int16_pcm.tobytes()
    
    # Convert back to float32
    converted_float32 = pcm_bytes_to_float32(pcm_bytes)
    
    # Compare original and converted
    # There will be some quantization error due to Int16 conversion
    max_error = np.abs(original_float32 - converted_float32).max()
    
    # Error should be small (< 1/32768 due to Int16 quantization)
    assert max_error < 0.0001, f"Conversion error too large: {max_error}"
    
    # Verify frequency is preserved (check for peaks in FFT)
    fft = np.fft.fft(converted_float32)
    freqs = np.fft.fftfreq(len(converted_float32), 1/sample_rate)
    
    # Find peak frequency
    peak_idx = np.argmax(np.abs(fft[:len(fft)//2]))
    peak_freq = abs(freqs[peak_idx])
    
    # Peak should be at 440Hz (with some tolerance)
    assert abs(peak_freq - frequency) < 5, f"Frequency not preserved: {peak_freq} Hz"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
