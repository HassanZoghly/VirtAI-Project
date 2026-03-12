"""
VAD integration tests with PCM buffer.

This test suite verifies VAD (Voice Activity Detection) integration with the
PCM audio pipeline. It tests:
- VAD flush with PCM buffer (speech → silence → flush)
- Timeout flush with continuous speech (no silence for 25 seconds)
- Multiple speech segments with pauses between them
- Buffer management works correctly with PCM data

Validates Requirements: 3.1, 3.2
"""

import asyncio
import time
import numpy as np
import pytest

from app.infrastructure.asr.audio_pipeline import AudioPipeline, BufferTimeoutError


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


@pytest.mark.asyncio
async def test_vad_flush_with_pcm_buffer():
    """
    Test VAD flush with PCM buffer (speech → silence → flush).
    
    Simulates:
    1. User speaks (audio chunks with is_final=False)
    2. VAD detects silence (final chunk with is_final=True)
    3. Buffer is flushed and processed
    
    Validates Requirements: 3.1
    """
    # Create audio pipeline
    pipeline = AudioPipeline()
    
    # Simulate speech: 5 chunks of audio (500ms total)
    speech_chunks = [generate_pcm_audio(duration_ms=100) for _ in range(5)]
    
    # Add speech chunks (not final)
    for chunk in speech_chunks:
        pipeline.add_pcm_chunk(chunk, is_final=False)
        assert not pipeline.should_process(), "Should not process during speech"
    
    # Verify buffer accumulated speech
    assert pipeline.get_buffer_size() > 0, "Buffer should contain speech data"
    
    # Simulate VAD detecting silence (final chunk)
    silence_chunk = generate_silence(duration_ms=100)
    pipeline.add_pcm_chunk(silence_chunk, is_final=True)
    
    # Verify VAD trigger
    assert pipeline.should_process(), "Should process after VAD detects silence"
    
    # Get audio for ASR
    audio_array = pipeline.get_audio_for_asr()
    assert len(audio_array) > 0, "Should have audio data for ASR"
    
    # Clear buffer (simulating transcription complete)
    pipeline.clear_buffer()
    assert pipeline.get_buffer_size() == 0, "Buffer should be empty after flush"


@pytest.mark.asyncio
async def test_timeout_flush_with_continuous_speech():
    """
    Test timeout flush with continuous speech (no silence for 25 seconds).
    
    Simulates:
    1. User speaks continuously without pauses
    2. No VAD silence detection (is_final=False for all chunks)
    3. Buffer duration reaches 25-second threshold
    4. Proactive flush is triggered
    
    Validates Requirements: 3.2
    """
    # Create audio pipeline with 25-second proactive flush threshold
    pipeline = AudioPipeline(max_buffer_duration=25.0)
    
    # Simulate continuous speech: add chunks without is_final
    # We'll use small chunks and manipulate time to simulate 25 seconds
    chunk = generate_pcm_audio(duration_ms=100)
    
    # Add first chunk to initialize timestamp
    pipeline.add_pcm_chunk(chunk, is_final=False)
    assert not pipeline.should_process(), "Should not process immediately"
    
    # Manipulate the started_at timestamp to simulate 25 seconds elapsed
    pipeline._started_at = time.time() - 25.0
    
    # Now should_process() should return True due to timeout
    assert pipeline.should_process(), "Should process after 25-second threshold"
    
    # Get audio for ASR
    audio_array = pipeline.get_audio_for_asr()
    assert len(audio_array) > 0, "Should have audio data for ASR"
    
    # Clear buffer
    pipeline.clear_buffer()


@pytest.mark.asyncio
async def test_multiple_speech_segments_with_pauses():
    """
    Test multiple speech segments with pauses between them.
    
    Simulates:
    1. User speaks (segment 1)
    2. VAD detects silence → flush
    3. User speaks again (segment 2)
    4. VAD detects silence → flush
    5. User speaks again (segment 3)
    6. VAD detects silence → flush
    
    Validates Requirements: 3.1, 3.2
    """
    # Create audio pipeline
    pipeline = AudioPipeline()
    
    # Segment 1: Speech → Silence → Flush
    speech1 = [generate_pcm_audio(duration_ms=100) for _ in range(3)]
    for chunk in speech1:
        pipeline.add_pcm_chunk(chunk, is_final=False)
    
    # VAD detects silence
    pipeline.add_pcm_chunk(generate_silence(duration_ms=50), is_final=True)
    assert pipeline.should_process(), "Should process segment 1"
    
    audio1 = pipeline.get_audio_for_asr()
    assert len(audio1) > 0, "Should have audio for segment 1"
    pipeline.clear_buffer()
    
    # Segment 2: Speech → Silence → Flush
    speech2 = [generate_pcm_audio(duration_ms=100, frequency=880) for _ in range(4)]
    for chunk in speech2:
        pipeline.add_pcm_chunk(chunk, is_final=False)
    
    # VAD detects silence
    pipeline.add_pcm_chunk(generate_silence(duration_ms=50), is_final=True)
    assert pipeline.should_process(), "Should process segment 2"
    
    audio2 = pipeline.get_audio_for_asr()
    assert len(audio2) > 0, "Should have audio for segment 2"
    pipeline.clear_buffer()
    
    # Segment 3: Speech → Silence → Flush
    speech3 = [generate_pcm_audio(duration_ms=100, frequency=220) for _ in range(2)]
    for chunk in speech3:
        pipeline.add_pcm_chunk(chunk, is_final=False)
    
    # VAD detects silence
    pipeline.add_pcm_chunk(generate_silence(duration_ms=50), is_final=True)
    assert pipeline.should_process(), "Should process segment 3"
    
    audio3 = pipeline.get_audio_for_asr()
    assert len(audio3) > 0, "Should have audio for segment 3"
    pipeline.clear_buffer()


@pytest.mark.asyncio
async def test_vad_buffer_management_with_pcm():
    """
    Test buffer management works correctly with PCM data.
    
    Verifies:
    - Buffer accumulates PCM chunks correctly
    - Buffer size is tracked accurately
    - Buffer is cleared after processing
    - Buffer can be reused after clearing
    
    Validates Requirements: 3.1, 3.2
    """
    # Create audio pipeline
    pipeline = AudioPipeline()
    
    # Add chunks and verify buffer size
    chunk1 = generate_pcm_audio(duration_ms=100)
    pipeline.add_pcm_chunk(chunk1, is_final=False)
    size1 = pipeline.get_buffer_size()
    assert size1 == len(chunk1), "Buffer size should match chunk size"
    
    chunk2 = generate_pcm_audio(duration_ms=100)
    pipeline.add_pcm_chunk(chunk2, is_final=False)
    size2 = pipeline.get_buffer_size()
    assert size2 == len(chunk1) + len(chunk2), "Buffer size should be cumulative"
    
    chunk3 = generate_pcm_audio(duration_ms=100)
    pipeline.add_pcm_chunk(chunk3, is_final=True)
    size3 = pipeline.get_buffer_size()
    assert size3 == len(chunk1) + len(chunk2) + len(chunk3), "Buffer size should include all chunks"
    
    # Process audio
    assert pipeline.should_process(), "Should be ready to process"
    audio_array = pipeline.get_audio_for_asr()
    assert len(audio_array) > 0, "Should have audio data"
    
    # Clear buffer
    pipeline.clear_buffer()
    assert pipeline.get_buffer_size() == 0, "Buffer should be empty after clear"
    
    # Verify buffer can be reused
    chunk4 = generate_pcm_audio(duration_ms=100)
    pipeline.add_pcm_chunk(chunk4, is_final=True)
    assert pipeline.get_buffer_size() == len(chunk4), "Buffer should work after clear"
    assert pipeline.should_process(), "Should be ready to process again"


@pytest.mark.asyncio
async def test_vad_with_speech_silence_speech_pattern():
    """
    Test VAD with speech-silence-speech pattern (no flush between).
    
    Simulates:
    1. User speaks
    2. Brief silence (but VAD doesn't trigger is_final yet)
    3. User continues speaking
    4. VAD finally detects silence → flush
    
    This tests that buffer correctly accumulates across brief pauses.
    
    Validates Requirements: 3.1
    """
    # Create audio pipeline
    pipeline = AudioPipeline()
    
    # Speech segment 1
    speech1 = [generate_pcm_audio(duration_ms=100) for _ in range(3)]
    for chunk in speech1:
        pipeline.add_pcm_chunk(chunk, is_final=False)
    
    # Brief silence (but no is_final trigger)
    silence = generate_silence(duration_ms=50)
    pipeline.add_pcm_chunk(silence, is_final=False)
    
    # Speech segment 2 (continuation)
    speech2 = [generate_pcm_audio(duration_ms=100) for _ in range(3)]
    for chunk in speech2:
        pipeline.add_pcm_chunk(chunk, is_final=False)
    
    # Final silence with VAD trigger
    final_silence = generate_silence(duration_ms=100)
    pipeline.add_pcm_chunk(final_silence, is_final=True)
    
    # Verify buffer accumulated all audio
    assert pipeline.should_process(), "Should process after final VAD trigger"
    
    audio_array = pipeline.get_audio_for_asr()
    
    # Total duration: 3*100 + 50 + 3*100 + 100 = 750ms at 16kHz = 12000 samples
    expected_samples = int(16000 * 0.750)
    assert len(audio_array) == expected_samples, \
        f"Should have {expected_samples} samples (all audio accumulated)"
    
    pipeline.clear_buffer()


@pytest.mark.asyncio
async def test_vad_timeout_interaction():
    """
    Test interaction between VAD trigger and timeout threshold.
    
    Verifies that VAD trigger (is_final=True) takes precedence over timeout.
    
    Validates Requirements: 3.1, 3.2
    """
    # Create audio pipeline
    pipeline = AudioPipeline(max_buffer_duration=25.0)
    
    # Add some chunks
    chunk = generate_pcm_audio(duration_ms=100)
    pipeline.add_pcm_chunk(chunk, is_final=False)
    
    # Manipulate timestamp to be close to timeout (24 seconds)
    pipeline._started_at = time.time() - 24.0
    
    # Should not process yet (not at 25-second threshold)
    assert not pipeline.should_process(), "Should not process before 25 seconds"
    
    # Add final chunk with VAD trigger (before timeout)
    pipeline.add_pcm_chunk(chunk, is_final=True)
    
    # Should process due to VAD trigger (not timeout)
    assert pipeline.should_process(), "Should process due to VAD trigger"
    
    # Get audio and clear
    audio_array = pipeline.get_audio_for_asr()
    assert len(audio_array) > 0, "Should have audio data"
    pipeline.clear_buffer()


@pytest.mark.asyncio
async def test_vad_preserves_buffer_limits():
    """
    Test that VAD integration preserves buffer size limits.
    
    Validates Requirements: 3.1, 3.2
    """
    from app.infrastructure.asr.audio_pipeline import BufferOverflowError
    
    # Create pipeline with small buffer limit
    pipeline = AudioPipeline(max_buffer_size=5000)
    
    # Add chunks until near limit
    chunk = generate_pcm_audio(duration_ms=100)  # ~3200 bytes
    pipeline.add_pcm_chunk(chunk, is_final=False)
    
    # Try to add another chunk that would overflow
    with pytest.raises(BufferOverflowError):
        pipeline.add_pcm_chunk(chunk, is_final=False)
    
    # Verify buffer limit is enforced even with is_final=True
    with pytest.raises(BufferOverflowError):
        pipeline.add_pcm_chunk(chunk, is_final=True)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
