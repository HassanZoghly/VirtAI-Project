"""
Buffer Size Invariant Property Tests for AudioBufferManager (Property 4)

**Validates: Requirements 4.4, 9.1**

Property 4: Buffer Size Invariant

_For all_ audio buffer operations, the total buffer size never exceeds max_buffer_size.

This property test validates that the AudioBufferManager enforces the critical buffer
size invariant - the total buffer size must NEVER exceed max_buffer_size under any
circumstances. This prevents memory exhaustion attacks and ensures system stability.

The invariant must hold:
1. After any sequence of add_chunk operations
2. When chunks are added up to the limit
3. When chunks would exceed the limit (BufferOverflowError raised)
4. After clear() operations
5. For any combination of chunk sizes and sequences
"""

import base64
import pytest
from hypothesis import given, strategies as st, settings, assume, HealthCheck

from app.services.audio_pipeline import (
    AudioPipeline,
    BufferOverflowError,
    BufferOverflowError,
)


# Strategy for generating audio chunk data
@st.composite
def audio_chunk_strategy(draw, min_size=1, max_size=1000):
    """
    Generate a valid AudioChunkMessage with random audio data.
    
    Args:
        draw: Hypothesis draw function
        min_size: Minimum audio data size in bytes
        max_size: Maximum audio data size in bytes
    
    Returns:
        AudioChunkMessage with random audio data
    """
    # Generate random audio data
    audio_size = draw(st.integers(min_value=min_size, max_value=max_size))
    audio_data = draw(st.binary(min_size=audio_size, max_size=audio_size))
    
    # Encode as base64
    audio_b64 = base64.b64encode(audio_data).decode()
    
    # Generate other fields
    is_final = draw(st.booleans())
    timestamp = draw(st.floats(min_value=0.0, max_value=10000.0, allow_nan=False, allow_infinity=False))
    audio_format = draw(st.sampled_from(["webm", "opus", "wav"]))
    
    return AudioChunkMessage(
        audio=audio_b64,
        is_final=is_final,
        timestamp=timestamp,
        format=audio_format
    )


@st.composite
def chunk_sequence_strategy(draw, max_buffer_size=10000):
    """
    Generate a sequence of audio chunks with various characteristics.
    
    Args:
        draw: Hypothesis draw function
        max_buffer_size: Maximum buffer size for the test
    
    Returns:
        List of AudioChunkMessage objects
    """
    num_chunks = draw(st.integers(min_value=1, max_value=20))
    chunks = []
    
    for _ in range(num_chunks):
        # Generate chunks with sizes that might or might not fit
        chunk = draw(audio_chunk_strategy(min_size=1, max_size=max_buffer_size // 2))
        chunks.append(chunk)
    
    return chunks


class TestBufferSizeInvariantProperty:
    """
    Property Tests: Buffer Size Invariant for AudioBufferManager
    
    These tests verify that the total buffer size NEVER exceeds max_buffer_size
    under any circumstances, preventing memory exhaustion and ensuring system stability.
    """

    @given(
        max_buffer_size=st.integers(min_value=100, max_value=10000),
        data=st.data(),
    )
    @settings(max_examples=50, deadline=None, suppress_health_check=[HealthCheck.data_too_large])
    def test_property_buffer_size_never_exceeds_limit(
        self, max_buffer_size: int, data
    ):
        """
        Property Test: Total buffer size never exceeds max_buffer_size.
        
        **Validates: Requirements 4.4, 9.1**
        
        This test verifies that for ANY sequence of add_chunk operations,
        the buffer size invariant holds:
        
        INVARIANT: buffer.get_total_size() <= buffer.max_buffer_size
        
        The buffer manager MUST either:
        1. Accept the chunk and maintain the invariant, OR
        2. Reject the chunk with BufferOverflowError and maintain the invariant
        
        The buffer size SHALL NEVER exceed max_buffer_size under any circumstances.
        """
        manager = AudioBufferManager(max_buffer_size=max_buffer_size)
        
        # Generate random chunks
        num_chunks = data.draw(st.integers(min_value=1, max_value=20))
        
        # Track expected size for verification
        expected_size = 0
        
        for _ in range(num_chunks):
            # Generate a chunk with random size
            chunk_size = data.draw(st.integers(min_value=1, max_value=max_buffer_size // 2))
            audio_data = b"x" * chunk_size
            audio_b64 = base64.b64encode(audio_data).decode()
            chunk = AudioChunkMessage(audio=audio_b64)
            
            # Check if chunk would fit
            would_fit = expected_size + chunk_size <= max_buffer_size
            
            if would_fit:
                # Chunk should be accepted
                manager.add_chunk(chunk)
                expected_size += chunk_size
                
                # INVARIANT: Buffer size must not exceed limit
                assert manager.get_total_size() <= max_buffer_size, \
                    f"Buffer size {manager.get_total_size()} exceeds limit {max_buffer_size}"
                
                # Verify size matches expected
                assert manager.get_total_size() == expected_size, \
                    f"Buffer size {manager.get_total_size()} does not match expected {expected_size}"
            else:
                # Chunk should be rejected with BufferOverflowError
                with pytest.raises(BufferOverflowError):
                    manager.add_chunk(chunk)
                
                # INVARIANT: Buffer size must not change after rejection
                assert manager.get_total_size() == expected_size, \
                    f"Buffer size changed after overflow: {manager.get_total_size()} != {expected_size}"
                
                # INVARIANT: Buffer size must still not exceed limit
                assert manager.get_total_size() <= max_buffer_size, \
                    f"Buffer size {manager.get_total_size()} exceeds limit {max_buffer_size} after overflow"

    @given(
        max_buffer_size=st.integers(min_value=100, max_value=10000),
        data=st.data(),
    )
    @settings(max_examples=50, deadline=None)
    def test_property_buffer_size_invariant_with_clears(
        self, max_buffer_size: int, data
    ):
        """
        Property Test: Buffer size invariant holds across add and clear operations.
        
        **Validates: Requirements 4.4, 4.6, 9.1**
        
        This test verifies that the buffer size invariant holds even when
        interleaving add_chunk and clear operations:
        
        INVARIANT: buffer.get_total_size() <= buffer.max_buffer_size
        
        After clear(), the buffer size MUST be 0, and subsequent operations
        MUST still maintain the invariant.
        """
        manager = AudioBufferManager(max_buffer_size=max_buffer_size)
        
        num_operations = data.draw(st.integers(min_value=1, max_value=50))
        
        for _ in range(num_operations):
            # Randomly choose to add chunk or clear
            op = data.draw(st.sampled_from(["add", "clear"]))
            
            if op == "add":
                # Generate a chunk
                chunk_size = data.draw(st.integers(min_value=1, max_value=max_buffer_size // 2))
                audio_data = b"x" * chunk_size
                audio_b64 = base64.b64encode(audio_data).decode()
                chunk = AudioChunkMessage(audio=audio_b64)
                
                current_size = manager.get_total_size()
                
                if current_size + chunk_size <= max_buffer_size:
                    manager.add_chunk(chunk)
                    
                    # INVARIANT: Buffer size must not exceed limit
                    assert manager.get_total_size() <= max_buffer_size, \
                        f"Buffer size {manager.get_total_size()} exceeds limit {max_buffer_size}"
                else:
                    # Should raise BufferOverflowError
                    with pytest.raises(BufferOverflowError):
                        manager.add_chunk(chunk)
                    
                    # INVARIANT: Buffer size unchanged after overflow
                    assert manager.get_total_size() == current_size, \
                        f"Buffer size changed after overflow"
            else:
                # Clear the buffer
                manager.clear()
                
                # INVARIANT: Buffer size must be 0 after clear
                assert manager.get_total_size() == 0, \
                    f"Buffer size {manager.get_total_size()} is not 0 after clear()"
                
                # INVARIANT: Still within limit (trivially true when size is 0)
                assert manager.get_total_size() <= max_buffer_size

    @given(
        max_buffer_size=st.integers(min_value=1000, max_value=100000),
        data=st.data(),
    )
    @settings(max_examples=30, deadline=None)
    def test_property_buffer_size_at_boundary(self, max_buffer_size: int, data):
        """
        Property Test: Buffer size invariant holds at exact boundary.
        
        **Validates: Requirements 4.4, 9.1**
        
        This test verifies that the buffer correctly handles chunks that
        fill the buffer to exactly max_buffer_size, and correctly rejects
        any additional chunks.
        
        INVARIANT: buffer.get_total_size() <= buffer.max_buffer_size
        """
        manager = AudioBufferManager(max_buffer_size=max_buffer_size)
        
        # Fill buffer to exactly max_buffer_size
        remaining = max_buffer_size
        
        while remaining > 0:
            # Add chunk that fits exactly or partially fills remaining space
            chunk_size = min(remaining, data.draw(st.integers(min_value=1, max_value=remaining)))
            audio_data = b"x" * chunk_size
            audio_b64 = base64.b64encode(audio_data).decode()
            chunk = AudioChunkMessage(audio=audio_b64)
            
            manager.add_chunk(chunk)
            remaining -= chunk_size
            
            # INVARIANT: Buffer size must not exceed limit
            assert manager.get_total_size() <= max_buffer_size, \
                f"Buffer size {manager.get_total_size()} exceeds limit {max_buffer_size}"
        
        # Buffer should be exactly at limit
        assert manager.get_total_size() == max_buffer_size, \
            f"Buffer size {manager.get_total_size()} does not equal limit {max_buffer_size}"
        
        # Try to add one more byte - should fail
        tiny_chunk = AudioChunkMessage(audio=base64.b64encode(b"x").decode())
        with pytest.raises(BufferOverflowError):
            manager.add_chunk(tiny_chunk)
        
        # INVARIANT: Buffer size must still be at limit (unchanged)
        assert manager.get_total_size() == max_buffer_size, \
            f"Buffer size changed after overflow attempt"

    @given(
        chunk_sizes=st.lists(
            st.integers(min_value=1, max_value=5000),
            min_size=1,
            max_size=20
        ),
    )
    @settings(max_examples=50, deadline=None)
    def test_property_total_size_equals_sum_of_chunks(self, chunk_sizes: list[int]):
        """
        Property Test: Total size always equals sum of accepted chunk sizes.
        
        **Validates: Requirements 4.2, 4.3, 4.4**
        
        This test verifies that the buffer correctly tracks the total size
        as the sum of all accepted chunks:
        
        INVARIANT: buffer.get_total_size() == sum(len(chunk) for chunk in buffer.get_chunks())
        
        This ensures accurate size tracking for the buffer size invariant.
        """
        max_buffer_size = sum(chunk_sizes) + 1000  # Ensure all chunks fit
        manager = AudioBufferManager(max_buffer_size=max_buffer_size)
        
        expected_total = 0
        
        for chunk_size in chunk_sizes:
            audio_data = b"x" * chunk_size
            audio_b64 = base64.b64encode(audio_data).decode()
            chunk = AudioChunkMessage(audio=audio_b64)
            
            manager.add_chunk(chunk)
            expected_total += chunk_size
            
            # INVARIANT: Total size equals sum of chunk sizes
            actual_total = sum(len(c) for c in manager.get_chunks())
            assert manager.get_total_size() == actual_total, \
                f"Total size {manager.get_total_size()} does not match sum of chunks {actual_total}"
            
            # Verify against expected
            assert manager.get_total_size() == expected_total, \
                f"Total size {manager.get_total_size()} does not match expected {expected_total}"
            
            # INVARIANT: Buffer size must not exceed limit
            assert manager.get_total_size() <= max_buffer_size, \
                f"Buffer size {manager.get_total_size()} exceeds limit {max_buffer_size}"

    @given(
        max_buffer_size=st.integers(min_value=100, max_value=10000),
        oversized_chunk_size=st.integers(min_value=10001, max_value=100000),
    )
    @settings(max_examples=30, deadline=None)
    def test_property_oversized_chunk_rejected(
        self, max_buffer_size: int, oversized_chunk_size: int
    ):
        """
        Property Test: Chunks larger than max_buffer_size are always rejected.
        
        **Validates: Requirements 4.4, 9.1**
        
        This test verifies that chunks larger than max_buffer_size are
        immediately rejected, even on an empty buffer:
        
        INVARIANT: If chunk_size > max_buffer_size, then BufferOverflowError is raised
        """
        assume(oversized_chunk_size > max_buffer_size)
        
        manager = AudioBufferManager(max_buffer_size=max_buffer_size)
        
        # Create oversized chunk
        audio_data = b"x" * oversized_chunk_size
        audio_b64 = base64.b64encode(audio_data).decode()
        chunk = AudioChunkMessage(audio=audio_b64)
        
        # Should raise BufferOverflowError
        with pytest.raises(BufferOverflowError):
            manager.add_chunk(chunk)
        
        # INVARIANT: Buffer remains empty
        assert manager.get_total_size() == 0, \
            f"Buffer size {manager.get_total_size()} is not 0 after rejecting oversized chunk"
        
        # INVARIANT: Buffer size does not exceed limit
        assert manager.get_total_size() <= max_buffer_size
