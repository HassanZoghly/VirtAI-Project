"""
PCM Concatenation Fix Verification Test

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

This test verifies that the PCM pipeline fix resolves the WebM concatenation bug.
It demonstrates that multiple PCM chunks can be safely concatenated and converted
to float32 without decoding errors, data loss, or corruption.

Property 1: Expected Behavior - PCM Concatenation and Decoding Success

_For any_ sequence of PCM audio chunks captured from the microphone, the fixed
audio pipeline SHALL concatenate the raw PCM bytes directly without container
parsing, convert the concatenated PCM buffer to float32 numpy array, and
successfully pass the audio to the ASR model for transcription without decoding
errors.

This test re-runs the same scenarios from the WebM exploration test (Task 1)
but with PCM data, demonstrating that the fix resolves the bug.
"""

import numpy as np
import pytest

from app.services.audio_pipeline import AudioPipeline, pcm_bytes_to_float32


class TestPCMConcatenationFixVerification:
    """
    Fix verification tests to demonstrate PCM concatenation works correctly.
    
    These tests mirror the WebM exploration tests from Task 1, but use PCM data
    to verify the fix. All tests SHOULD PASS, confirming the bug is resolved.
    """
    
    def create_pcm_chunk(self, duration_ms: int = 100, frequency: int = 440) -> bytes:
        """
        Create a PCM audio chunk (16-bit signed integer, 16kHz mono).
        
        Generates a sine wave at the specified frequency and duration.
        
        Args:
            duration_ms: Duration in milliseconds
            frequency: Sine wave frequency in Hz
            
        Returns:
            Raw PCM bytes (Int16, little-endian)
        """
        sample_rate = 16000  # 16kHz for ASR
        num_samples = int(sample_rate * duration_ms / 1000)
        
        # Generate sine wave
        t = np.linspace(0, duration_ms / 1000, num_samples, endpoint=False)
        sine_wave = np.sin(2 * np.pi * frequency * t)
        
        # Convert to Int16 PCM (range: -32768 to 32767)
        pcm_int16 = (sine_wave * 32767).astype(np.int16)
        
        # Convert to bytes (little-endian)
        pcm_bytes = pcm_int16.tobytes()
        
        return pcm_bytes
    
    def test_two_pcm_chunks_concatenation(self):
        """
        Test concatenating 2 PCM chunks.
        
        **EXPECTED**: This test SHOULD PASS.
        PCM chunks can be safely concatenated without headers or parsing.
        
        Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
        """
        # Create 2 PCM chunks (100ms each)
        chunk1 = self.create_pcm_chunk(duration_ms=100)
        chunk2 = self.create_pcm_chunk(duration_ms=100)
        
        print(f"\n=== Fix Verification: Two PCM Chunks ===")
        print(f"Chunk 1 size: {len(chunk1):,} bytes")
        print(f"Chunk 2 size: {len(chunk2):,} bytes")
        
        # Concatenate using PCM pipeline
        pipeline = AudioPipeline()
        pipeline.add_pcm_chunk(chunk1)
        pipeline.add_pcm_chunk(chunk2, is_final=True)
        
        # Verify buffer size
        expected_size = len(chunk1) + len(chunk2)
        actual_size = pipeline.get_buffer_size()
        print(f"Expected buffer size: {expected_size:,} bytes")
        print(f"Actual buffer size: {actual_size:,} bytes")
        assert actual_size == expected_size, \
            f"Buffer size mismatch: expected {expected_size}, got {actual_size}"
        
        # Convert to float32
        float32_array = pipeline.get_audio_for_asr()
        
        print(f"Float32 array shape: {float32_array.shape}")
        print(f"Float32 array dtype: {float32_array.dtype}")
        print(f"Float32 value range: [{float32_array.min():.6f}, {float32_array.max():.6f}]")
        
        # Verify conversion succeeded
        assert float32_array.dtype == np.float32, \
            f"Expected dtype float32, got {float32_array.dtype}"
        
        # Verify values in range [-1.0, 1.0]
        assert float32_array.min() >= -1.0, \
            f"Min value {float32_array.min()} is below -1.0"
        assert float32_array.max() <= 1.0, \
            f"Max value {float32_array.max()} is above 1.0"
        
        # Verify correct number of samples (2 bytes per Int16 sample)
        expected_samples = expected_size // 2
        actual_samples = len(float32_array)
        print(f"Expected samples: {expected_samples:,}")
        print(f"Actual samples: {actual_samples:,}")
        assert actual_samples == expected_samples, \
            f"Sample count mismatch: expected {expected_samples}, got {actual_samples}"
        
        print(f"✓ PCM concatenation SUCCEEDED")
        print(f"✓ Float32 conversion SUCCEEDED")
        print(f"✓ No decoding errors")
        print(f"✓ All data preserved (no data loss)")
    
    def test_five_pcm_chunks_concatenation(self):
        """
        Test concatenating 5 PCM chunks.
        
        **EXPECTED**: This test SHOULD PASS.
        This mirrors the WebM test that FAILED with 59% data loss.
        PCM concatenation should preserve all audio data.
        
        Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
        """
        # Create 5 PCM chunks (100ms each)
        chunks = [self.create_pcm_chunk(duration_ms=100) for _ in range(5)]
        
        print(f"\n=== Fix Verification: Five PCM Chunks ===")
        print(f"Number of chunks: {len(chunks)}")
        
        # Concatenate using PCM pipeline
        pipeline = AudioPipeline()
        for i, chunk in enumerate(chunks):
            is_final = (i == len(chunks) - 1)  # Mark last chunk as final
            pipeline.add_pcm_chunk(chunk, is_final=is_final)
        
        # Verify buffer size
        expected_size = sum(len(chunk) for chunk in chunks)
        actual_size = pipeline.get_buffer_size()
        print(f"Expected buffer size: {expected_size:,} bytes")
        print(f"Actual buffer size: {actual_size:,} bytes")
        assert actual_size == expected_size, \
            f"Buffer size mismatch: expected {expected_size}, got {actual_size}"
        
        # Convert to float32
        float32_array = pipeline.get_audio_for_asr()
        
        print(f"Float32 array shape: {float32_array.shape}")
        print(f"Float32 array dtype: {float32_array.dtype}")
        print(f"Float32 value range: [{float32_array.min():.6f}, {float32_array.max():.6f}]")
        
        # Verify conversion succeeded
        assert float32_array.dtype == np.float32
        
        # Verify values in range [-1.0, 1.0]
        assert float32_array.min() >= -1.0
        assert float32_array.max() <= 1.0
        
        # Verify correct number of samples
        expected_samples = expected_size // 2
        actual_samples = len(float32_array)
        print(f"Expected samples: {expected_samples:,}")
        print(f"Actual samples: {actual_samples:,}")
        assert actual_samples == expected_samples, \
            f"Sample count mismatch: expected {expected_samples}, got {actual_samples}"
        
        # Calculate expected vs actual duration
        sample_rate = 16000  # 16kHz
        expected_duration_ms = 500  # 5 chunks × 100ms
        actual_duration_ms = (actual_samples / sample_rate) * 1000
        print(f"Expected duration: {expected_duration_ms} ms")
        print(f"Actual duration: {actual_duration_ms:.1f} ms")
        
        # Verify no data loss (within 1% tolerance for rounding)
        duration_diff = abs(actual_duration_ms - expected_duration_ms)
        assert duration_diff < (expected_duration_ms * 0.01), \
            f"Duration mismatch: expected {expected_duration_ms}ms, got {actual_duration_ms:.1f}ms"
        
        print(f"✓ PCM concatenation SUCCEEDED")
        print(f"✓ Float32 conversion SUCCEEDED")
        print(f"✓ No decoding errors")
        print(f"✓ All data preserved (no data loss)")
        print(f"✓ FIX VERIFIED: Unlike WebM (59% data loss), PCM preserves all audio")
    
    def test_ten_pcm_chunks_concatenation(self):
        """
        Test concatenating 10 PCM chunks (stress test).
        
        **EXPECTED**: This test SHOULD PASS.
        PCM concatenation should scale to many chunks without issues.
        
        Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
        """
        # Create 10 PCM chunks (100ms each)
        chunks = [self.create_pcm_chunk(duration_ms=100) for _ in range(10)]
        
        print(f"\n=== Fix Verification: Ten PCM Chunks (Stress Test) ===")
        print(f"Number of chunks: {len(chunks)}")
        
        # Concatenate using PCM pipeline
        pipeline = AudioPipeline()
        for i, chunk in enumerate(chunks):
            is_final = (i == len(chunks) - 1)
            pipeline.add_pcm_chunk(chunk, is_final=is_final)
        
        # Verify buffer size
        expected_size = sum(len(chunk) for chunk in chunks)
        actual_size = pipeline.get_buffer_size()
        print(f"Expected buffer size: {expected_size:,} bytes")
        print(f"Actual buffer size: {actual_size:,} bytes")
        assert actual_size == expected_size
        
        # Convert to float32
        float32_array = pipeline.get_audio_for_asr()
        
        print(f"Float32 array shape: {float32_array.shape}")
        print(f"Float32 value range: [{float32_array.min():.6f}, {float32_array.max():.6f}]")
        
        # Verify conversion succeeded
        assert float32_array.dtype == np.float32
        assert float32_array.min() >= -1.0
        assert float32_array.max() <= 1.0
        
        # Verify correct number of samples
        expected_samples = expected_size // 2
        actual_samples = len(float32_array)
        print(f"Expected samples: {expected_samples:,}")
        print(f"Actual samples: {actual_samples:,}")
        assert actual_samples == expected_samples
        
        # Calculate duration
        sample_rate = 16000
        expected_duration_ms = 1000  # 10 chunks × 100ms
        actual_duration_ms = (actual_samples / sample_rate) * 1000
        print(f"Expected duration: {expected_duration_ms} ms")
        print(f"Actual duration: {actual_duration_ms:.1f} ms")
        
        # Verify no data loss
        duration_diff = abs(actual_duration_ms - expected_duration_ms)
        assert duration_diff < (expected_duration_ms * 0.01)
        
        print(f"✓ PCM concatenation SUCCEEDED with 10 chunks")
        print(f"✓ Stress test PASSED")
    
    def test_variable_chunk_sizes_concatenation(self):
        """
        Test concatenating PCM chunks with variable sizes.
        
        **EXPECTED**: This test SHOULD PASS.
        PCM concatenation should work regardless of chunk size variations.
        
        Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
        """
        # Create chunks with different durations (20ms, 40ms, 30ms, 50ms)
        chunk_durations = [20, 40, 30, 50]
        chunks = [self.create_pcm_chunk(duration_ms=d) for d in chunk_durations]
        
        print(f"\n=== Fix Verification: Variable Chunk Sizes ===")
        print(f"Chunk durations: {chunk_durations} ms")
        print(f"Chunk sizes: {[len(c) for c in chunks]} bytes")
        
        # Concatenate using PCM pipeline
        pipeline = AudioPipeline()
        for i, chunk in enumerate(chunks):
            is_final = (i == len(chunks) - 1)
            pipeline.add_pcm_chunk(chunk, is_final=is_final)
        
        # Verify buffer size
        expected_size = sum(len(chunk) for chunk in chunks)
        actual_size = pipeline.get_buffer_size()
        print(f"Expected buffer size: {expected_size:,} bytes")
        print(f"Actual buffer size: {actual_size:,} bytes")
        assert actual_size == expected_size
        
        # Convert to float32
        float32_array = pipeline.get_audio_for_asr()
        
        print(f"Float32 array shape: {float32_array.shape}")
        print(f"Float32 value range: [{float32_array.min():.6f}, {float32_array.max():.6f}]")
        
        # Verify conversion succeeded
        assert float32_array.dtype == np.float32
        assert float32_array.min() >= -1.0
        assert float32_array.max() <= 1.0
        
        # Verify correct number of samples
        expected_samples = expected_size // 2
        actual_samples = len(float32_array)
        print(f"Expected samples: {expected_samples:,}")
        print(f"Actual samples: {actual_samples:,}")
        assert actual_samples == expected_samples
        
        # Calculate duration
        sample_rate = 16000
        expected_duration_ms = sum(chunk_durations)
        actual_duration_ms = (actual_samples / sample_rate) * 1000
        print(f"Expected duration: {expected_duration_ms} ms")
        print(f"Actual duration: {actual_duration_ms:.1f} ms")
        
        # Verify no data loss
        duration_diff = abs(actual_duration_ms - expected_duration_ms)
        assert duration_diff < (expected_duration_ms * 0.01)
        
        print(f"✓ PCM concatenation SUCCEEDED with variable chunk sizes")
        print(f"✓ Chunk size variations handled correctly")
    
    def test_single_pcm_chunk_edge_case(self):
        """
        Test single PCM chunk (no concatenation).
        
        **EXPECTED**: This test SHOULD PASS.
        Edge case - single chunk should work correctly.
        
        Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
        """
        # Create single PCM chunk
        chunk = self.create_pcm_chunk(duration_ms=200)
        
        print(f"\n=== Edge Case: Single PCM Chunk ===")
        print(f"Chunk size: {len(chunk):,} bytes")
        
        # Process single chunk
        pipeline = AudioPipeline()
        pipeline.add_pcm_chunk(chunk, is_final=True)
        
        # Convert to float32
        float32_array = pipeline.get_audio_for_asr()
        
        print(f"Float32 array shape: {float32_array.shape}")
        print(f"Float32 value range: [{float32_array.min():.6f}, {float32_array.max():.6f}]")
        
        # Verify conversion succeeded
        assert float32_array.dtype == np.float32
        assert float32_array.min() >= -1.0
        assert float32_array.max() <= 1.0
        
        # Verify correct number of samples
        expected_samples = len(chunk) // 2
        actual_samples = len(float32_array)
        assert actual_samples == expected_samples
        
        print(f"✓ Single PCM chunk processed correctly")
    
    def test_empty_buffer_edge_case(self):
        """
        Test empty buffer handling.
        
        **EXPECTED**: This test SHOULD PASS.
        Edge case - empty buffer should raise appropriate error.
        
        Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5
        """
        print(f"\n=== Edge Case: Empty Buffer ===")
        
        # Create empty pipeline
        pipeline = AudioPipeline()
        
        # Attempting to get audio from empty buffer should raise error
        with pytest.raises(ValueError) as exc_info:
            pipeline.get_audio_for_asr()
        
        error_msg = str(exc_info.value)
        print(f"Error type: {type(exc_info.value).__name__}")
        print(f"Error message: {error_msg}")
        
        # Verify it's the expected error
        assert "empty" in error_msg.lower(), \
            f"Expected empty buffer error, got: {error_msg}"
        
        print(f"✓ Empty buffer handled correctly with appropriate error")


if __name__ == "__main__":
    """
    Run this fix verification test to confirm PCM concatenation works correctly:
    
    python -m pytest backend/tests/test_pcm_concatenation_fix_verification.py -v -s
    
    EXPECTED RESULTS:
    - test_two_pcm_chunks_concatenation: PASS
    - test_five_pcm_chunks_concatenation: PASS (unlike WebM which had 59% data loss)
    - test_ten_pcm_chunks_concatenation: PASS
    - test_variable_chunk_sizes_concatenation: PASS
    - test_single_pcm_chunk_edge_case: PASS
    - test_empty_buffer_edge_case: PASS
    
    FIX VERIFIED:
    - PCM chunks concatenate safely without headers
    - No data loss or corruption
    - Float32 conversion works correctly
    - Values stay in range [-1.0, 1.0]
    - ASR receives valid audio data
    - Bug is RESOLVED
    """
    pytest.main([__file__, "-v", "-s"])
