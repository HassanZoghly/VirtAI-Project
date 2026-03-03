"""Property-based tests for VAD-based silence detection preservation.

**Validates: Requirements 3.1, 3.2, 3.3**

These tests verify that VAD-based silence detection (is_final=True) continues
to work correctly and remains the primary trigger for ASR processing. They
should PASS on unfixed code to establish baseline behavior that must be preserved.

Property 2: Preservation - VAD-Based Silence Detection Priority

For any buffer state where VAD detects silence (is_final=True) before the buffer
duration reaches the proactive threshold, the code SHALL trigger ASR processing
immediately via the is_final flag, preserving the existing VAD-based processing
flow and ensuring no behavioral change for normal speech patterns.
"""

import base64
import time
import pytest
from hypothesis import given, strategies as st, settings, assume, HealthCheck

from app.services.audio_pipeline import (
    AudioPipeline,
    BufferOverflowError,
)


# Strategy: Generate PCM audio chunks
@st.composite
def pcm_chunk_strategy(draw, is_final=None, min_size=10, max_size=1000):
    """Generate valid PCM audio chunks (raw bytes).
    
    Args:
        draw: Hypothesis draw function
        is_final: Fixed is_final value, or None to generate randomly
        min_size: Minimum audio data size in bytes
        max_size: Maximum audio data size in bytes
    
    Returns:
        Tuple of (pcm_bytes, is_final)
    """
    # Generate random audio data (must be even for Int16 PCM)
    audio_size = draw(st.integers(min_value=min_size, max_value=max_size))
    if audio_size % 2 != 0:
        audio_size += 1
    audio_data = draw(st.binary(min_size=audio_size, max_size=audio_size))
    
    # Generate is_final flag
    if is_final is None:
        is_final_value = draw(st.booleans())
    else:
        is_final_value = is_final
    
    return (audio_data, is_final_value)


# Strategy: Generate list of audio chunks with controlled is_final placement
@st.composite
def chunk_sequence_with_final(draw, min_chunks=1, max_chunks=10, final_position="last"):
    """Generate a sequence of audio chunks with is_final=True at specified position.
    
    Args:
        draw: Hypothesis draw function
        min_chunks: Minimum number of chunks
        max_chunks: Maximum number of chunks
        final_position: Where to place is_final=True ("last", "middle", "first")
    
    Returns:
        List of (pcm_bytes, is_final) tuples
    """
    num_chunks = draw(st.integers(min_value=min_chunks, max_value=max_chunks))
    chunks = []
    
    for i in range(num_chunks):
        # Determine if this chunk should be final
        if final_position == "last" and i == num_chunks - 1:
            chunk = draw(pcm_chunk_strategy(is_final=True))
        elif final_position == "first" and i == 0:
            chunk = draw(pcm_chunk_strategy(is_final=True))
        elif final_position == "middle" and i == num_chunks // 2:
            chunk = draw(pcm_chunk_strategy(is_final=True))
        else:
            chunk = draw(pcm_chunk_strategy(is_final=False))
        
        chunks.append(chunk)
    
    return chunks


class TestVADPreservationProperty:
    """Property-based tests for VAD-based silence detection preservation.
    
    These tests verify that is_final=True immediately triggers should_process()=True
    regardless of buffer duration, preserving the existing VAD-based processing flow.
    """
    
    @given(chunk=pcm_chunk_strategy(is_final=True))
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_is_final_true_immediately_triggers_processing(self, chunk):
        """Property: For all chunks with is_final=True, should_process() returns True.
        
        **Validates: Requirements 3.1, 3.2, 3.3**
        
        This test verifies that VAD-based silence detection (is_final=True) immediately
        triggers ASR processing regardless of buffer duration. This is the baseline
        behavior that must be preserved after the fix.
        """
        pipeline = AudioPipeline()
        pcm_bytes, is_final = chunk
        
        # Add chunk with is_final=True
        pipeline.add_pcm_chunk(pcm_bytes, is_final=is_final)
        
        # Verify should_process() returns True immediately
        assert pipeline.should_process() is True, \
            "is_final=True should immediately trigger should_process()=True"
    
    @given(chunks=chunk_sequence_with_final(min_chunks=1, max_chunks=20, final_position="last"))
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow])
    def test_final_chunk_triggers_processing_in_sequence(self, chunks):
        """Property: For all chunk sequences ending with is_final=True, should_process() returns True.
        
        **Validates: Requirements 3.1, 3.2, 3.3**
        
        This test verifies that VAD-based silence detection works correctly in realistic
        scenarios where multiple non-final chunks are followed by a final chunk.
        """
        pipeline = AudioPipeline()
        
        # Add all chunks except the last one
        for pcm_bytes, is_final in chunks[:-1]:
            pipeline.add_pcm_chunk(pcm_bytes, is_final=is_final)
            # should_process() should be False until final chunk
            assert pipeline.should_process() is False, \
                "should_process() should be False before final chunk"
        
        # Add the final chunk (which has is_final=True)
        pcm_bytes, is_final = chunks[-1]
        pipeline.add_pcm_chunk(pcm_bytes, is_final=is_final)
        
        # Verify should_process() returns True after final chunk
        assert pipeline.should_process() is True, \
            "should_process() should be True after is_final=True chunk"
    
    @given(
        num_chunks=st.integers(min_value=1, max_value=10),
        chunk_size=st.integers(min_value=100, max_value=5000)
    )
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_short_utterances_with_final_process_correctly(self, num_chunks, chunk_size):
        """Property: For all short utterances (<25 seconds) with is_final=True, processing triggers.
        
        **Validates: Requirements 3.1, 3.2, 3.3**
        
        This test verifies that short utterances (typical speech segments) with VAD-detected
        silence continue to be processed correctly. These should be unaffected by the fix.
        """
        # Ensure chunk_size is even for Int16 PCM
        if chunk_size % 2 != 0:
            chunk_size += 1
            
        pipeline = AudioPipeline()
        
        # Add non-final chunks (simulating short utterance)
        for i in range(num_chunks - 1):
            audio_data = b"x" * chunk_size
            pipeline.add_pcm_chunk(audio_data, is_final=False)
        
        # Add final chunk with is_final=True
        audio_data = b"x" * chunk_size
        pipeline.add_pcm_chunk(audio_data, is_final=True)
        
        # Verify should_process() returns True
        assert pipeline.should_process() is True, \
            "Short utterances with is_final=True should trigger processing"
    
    @given(
        num_segments=st.integers(min_value=2, max_value=5),
        segment_chunks=st.integers(min_value=1, max_value=5)
    )
    @settings(
        max_examples=30,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
        deadline=None  # Disable deadline for tests with intentional delays
    )
    def test_normal_speech_patterns_with_pauses_process_via_vad(self, num_segments, segment_chunks):
        """Property: For all normal speech patterns with pauses, VAD triggers processing.
        
        **Validates: Requirements 3.1, 3.2, 3.3**
        
        This test simulates normal speech with natural pauses (5-10 second segments).
        Each segment ends with is_final=True when VAD detects silence. This is the
        typical use case that must remain unchanged.
        """
        pipeline = AudioPipeline()
        
        for segment in range(num_segments):
            # Add chunks for this speech segment
            for i in range(segment_chunks):
                audio_data = b"speech_data" * 100
                
                # Last chunk in segment has is_final=True (VAD detected silence)
                is_final = (i == segment_chunks - 1)
                pipeline.add_pcm_chunk(audio_data, is_final=is_final)
                
                time.sleep(0.01)  # Small delay
            
            # Verify should_process() returns True after each segment
            assert pipeline.should_process() is True, \
                f"Segment {segment + 1} should trigger processing via VAD"
            
            # Clear buffer for next segment (simulating ASR processing)
            pipeline.clear_buffer()
            
            # After clear, should_process() should be False
            assert pipeline.should_process() is False, \
                "should_process() should be False after buffer clear"
    
    @given(
        duration_seconds=st.floats(min_value=0.1, max_value=24.0, allow_nan=False, allow_infinity=False),
        chunk_size=st.integers(min_value=100, max_value=5000)
    )
    @settings(
        max_examples=50,
        suppress_health_check=[HealthCheck.function_scoped_fixture],
        deadline=None  # Disable deadline for tests with intentional delays
    )
    def test_buffer_with_duration_less_than_25_seconds_and_no_final_does_not_process(
        self, duration_seconds, chunk_size
    ):
        """Property: For all buffers with duration <25s and is_final=False, should_process() returns False.
        
        **Validates: Requirements 3.1, 3.2, 3.3**
        
        This test verifies the baseline behavior: without is_final=True and with duration
        below the proactive threshold (25 seconds), should_process() returns False.
        This establishes the boundary condition for the preservation property.
        """
        # Ensure chunk_size is even for Int16 PCM
        if chunk_size % 2 != 0:
            chunk_size += 1
            
        pipeline = AudioPipeline()
        
        # Calculate number of chunks to add based on desired duration
        # Assuming each chunk takes ~0.1 seconds to process
        num_chunks = max(1, int(duration_seconds / 0.1))
        
        # Add chunks without is_final=True
        for i in range(num_chunks):
            audio_data = b"x" * chunk_size
            pipeline.add_pcm_chunk(audio_data, is_final=False)
            time.sleep(0.1)  # Simulate realistic chunk arrival timing
        
        # Verify should_process() returns False (no VAD silence detected)
        assert pipeline.should_process() is False, \
            "should_process() should be False without is_final=True and duration <25s"
    
    @given(chunk=pcm_chunk_strategy(is_final=True))
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_is_final_true_overrides_duration_check(self, chunk):
        """Property: For all chunks with is_final=True, should_process() returns True regardless of duration.
        
        **Validates: Requirements 3.1, 3.2, 3.3**
        
        This test verifies that is_final=True is the primary trigger and takes precedence
        over any duration-based checks. This is critical for preservation - VAD must
        remain the primary mechanism.
        """
        pipeline = AudioPipeline()
        pcm_bytes, is_final = chunk
        
        # Add chunk with is_final=True (regardless of when it arrives)
        pipeline.add_pcm_chunk(pcm_bytes, is_final=is_final)
        
        # Verify should_process() returns True immediately
        assert pipeline.should_process() is True, \
            "is_final=True should trigger processing regardless of buffer duration"
        
        # Verify this works even after adding more non-final chunks
        audio_data = b"more_data" * 100
        pipeline.add_pcm_chunk(audio_data, is_final=False)
        
        # should_process() should still be True (final flag persists)
        assert pipeline.should_process() is True, \
            "is_final flag should persist after adding more chunks"
