"""Unit tests for audio_pipeline module.

Tests the AudioPipeline class for PCM buffer accumulation, VAD integration,
and conversion to float32 numpy arrays for ASR input.
"""

import pytest
import numpy as np
import time
from app.services.audio_pipeline import (
    AudioPipeline,
    pcm_bytes_to_float32,
    BufferOverflowError,
    BufferTimeoutError,
    ChunkSizeError,
)


class TestPCMBytesToFloat32:
    """Test PCM bytes to float32 conversion function."""
    
    def test_conversion_range(self):
        """Test that conversion produces values in range [-1.0, 1.0]."""
        # Create Int16 PCM bytes with max/min values
        int16_array = np.array([-32768, -16384, 0, 16384, 32767], dtype=np.int16)
        pcm_bytes = int16_array.tobytes()
        
        # Convert to float32
        float32_array = pcm_bytes_to_float32(pcm_bytes)
        
        # Verify range
        assert float32_array.dtype == np.float32
        assert float32_array.min() >= -1.0
        assert float32_array.max() <= 1.0
        
        # Verify specific values
        assert float32_array[0] == -1.0  # -32768 / 32768
        assert float32_array[2] == 0.0   # 0 / 32768
        assert abs(float32_array[4] - 0.999969482421875) < 1e-6  # 32767 / 32768
    
    def test_empty_bytes_raises_error(self):
        """Test that empty bytes raises ValueError."""
        with pytest.raises(ValueError, match="pcm_bytes cannot be empty"):
            pcm_bytes_to_float32(b"")
    
    def test_odd_length_raises_error(self):
        """Test that odd-length bytes raises ValueError."""
        with pytest.raises(ValueError, match="not a multiple of 2"):
            pcm_bytes_to_float32(b"abc")  # 3 bytes (odd)
    
    def test_conversion_preserves_length(self):
        """Test that conversion produces correct number of samples."""
        # Create 100 samples (200 bytes)
        int16_array = np.random.randint(-32768, 32767, size=100, dtype=np.int16)
        pcm_bytes = int16_array.tobytes()
        
        # Convert to float32
        float32_array = pcm_bytes_to_float32(pcm_bytes)
        
        # Verify length
        assert len(float32_array) == 100
        assert len(pcm_bytes) == 200  # 2 bytes per sample


class TestAudioPipeline:
    """Test AudioPipeline class for PCM buffer management."""
    
    def test_initialization(self):
        """Test AudioPipeline initialization with default parameters."""
        pipeline = AudioPipeline()
        
        assert pipeline.max_buffer_size == 10 * 1024 * 1024
        assert pipeline.max_chunk_size == 1 * 1024 * 1024
        assert pipeline.buffer_timeout == 30.0
        assert pipeline.max_buffer_duration == 25.0
        assert pipeline.get_buffer_size() == 0
        assert not pipeline.should_process()
    
    def test_initialization_with_custom_params(self):
        """Test AudioPipeline initialization with custom parameters."""
        pipeline = AudioPipeline(
            max_buffer_size=5 * 1024 * 1024,
            max_chunk_size=512 * 1024,
            buffer_timeout=20.0,
            max_buffer_duration=15.0,
        )
        
        assert pipeline.max_buffer_size == 5 * 1024 * 1024
        assert pipeline.max_chunk_size == 512 * 1024
        assert pipeline.buffer_timeout == 20.0
        assert pipeline.max_buffer_duration == 15.0
    
    def test_invalid_initialization_params(self):
        """Test that invalid initialization parameters raise ValueError."""
        with pytest.raises(ValueError, match="max_buffer_size must be positive"):
            AudioPipeline(max_buffer_size=0)
        
        with pytest.raises(ValueError, match="max_chunk_size must be positive"):
            AudioPipeline(max_chunk_size=-1)
        
        with pytest.raises(ValueError, match="buffer_timeout must be positive"):
            AudioPipeline(buffer_timeout=0)
        
        with pytest.raises(ValueError, match="max_buffer_duration must be less than buffer_timeout"):
            AudioPipeline(max_buffer_duration=30.0, buffer_timeout=30.0)
    
    def test_add_pcm_chunk_basic(self):
        """Test adding a single PCM chunk to buffer."""
        pipeline = AudioPipeline()
        
        # Create PCM chunk (100 samples = 200 bytes)
        int16_array = np.random.randint(-32768, 32767, size=100, dtype=np.int16)
        pcm_bytes = int16_array.tobytes()
        
        # Add chunk
        pipeline.add_pcm_chunk(pcm_bytes)
        
        # Verify buffer size
        assert pipeline.get_buffer_size() == 200
        assert not pipeline.should_process()  # No is_final flag
    
    def test_add_multiple_pcm_chunks(self):
        """Test adding multiple PCM chunks to buffer."""
        pipeline = AudioPipeline()
        
        # Add 5 chunks
        for i in range(5):
            int16_array = np.random.randint(-32768, 32767, size=100, dtype=np.int16)
            pcm_bytes = int16_array.tobytes()
            pipeline.add_pcm_chunk(pcm_bytes)
        
        # Verify buffer size (5 chunks * 200 bytes = 1000 bytes)
        assert pipeline.get_buffer_size() == 1000
        assert not pipeline.should_process()
    
    def test_add_pcm_chunk_with_is_final(self):
        """Test that is_final flag triggers should_process."""
        pipeline = AudioPipeline()
        
        # Add chunk without is_final
        int16_array = np.random.randint(-32768, 32767, size=100, dtype=np.int16)
        pcm_bytes = int16_array.tobytes()
        pipeline.add_pcm_chunk(pcm_bytes, is_final=False)
        assert not pipeline.should_process()
        
        # Add chunk with is_final
        pipeline.add_pcm_chunk(pcm_bytes, is_final=True)
        assert pipeline.should_process()  # VAD trigger
    
    def test_empty_chunk_raises_error(self):
        """Test that empty PCM chunk raises ValueError."""
        pipeline = AudioPipeline()
        
        with pytest.raises(ValueError, match="pcm_bytes cannot be empty"):
            pipeline.add_pcm_chunk(b"")
    
    def test_non_bytes_raises_error(self):
        """Test that non-bytes input raises ValueError."""
        pipeline = AudioPipeline()
        
        with pytest.raises(ValueError, match="pcm_bytes must be bytes object"):
            pipeline.add_pcm_chunk("not bytes")
    
    def test_chunk_size_limit(self):
        """Test that exceeding chunk size limit raises ChunkSizeError."""
        pipeline = AudioPipeline(max_chunk_size=1000)
        
        # Create chunk larger than limit
        large_chunk = b"x" * 1001
        
        with pytest.raises(ChunkSizeError, match="exceeds maximum allowed chunk size"):
            pipeline.add_pcm_chunk(large_chunk)
    
    def test_buffer_overflow(self):
        """Test that exceeding buffer size limit raises BufferOverflowError."""
        pipeline = AudioPipeline(max_buffer_size=1000)
        
        # Add chunks that exceed buffer limit
        chunk = b"x" * 600
        pipeline.add_pcm_chunk(chunk)
        
        with pytest.raises(BufferOverflowError, match="would exceed max_buffer_size"):
            pipeline.add_pcm_chunk(chunk)  # 600 + 600 > 1000
    
    def test_get_audio_for_asr(self):
        """Test converting PCM buffer to float32 numpy array."""
        pipeline = AudioPipeline()
        
        # Add PCM chunks
        int16_array = np.array([0, 16384, -16384, 32767, -32768], dtype=np.int16)
        pcm_bytes = int16_array.tobytes()
        pipeline.add_pcm_chunk(pcm_bytes)
        
        # Get audio for ASR
        float32_array = pipeline.get_audio_for_asr()
        
        # Verify conversion
        assert float32_array.dtype == np.float32
        assert len(float32_array) == 5
        assert float32_array.min() >= -1.0
        assert float32_array.max() <= 1.0
    
    def test_get_audio_for_asr_empty_buffer(self):
        """Test that getting audio from empty buffer raises ValueError."""
        pipeline = AudioPipeline()
        
        with pytest.raises(ValueError, match="Cannot convert empty buffer"):
            pipeline.get_audio_for_asr()
    
    def test_get_audio_for_asr_odd_length(self):
        """Test that odd-length buffer raises ValueError."""
        pipeline = AudioPipeline()
        
        # Manually add odd-length data (this shouldn't happen in practice)
        pipeline._buffer.extend(b"abc")  # 3 bytes (odd)
        
        with pytest.raises(ValueError, match="not a multiple of 2"):
            pipeline.get_audio_for_asr()
    
    def test_clear_buffer(self):
        """Test clearing buffer resets all state."""
        pipeline = AudioPipeline()
        
        # Add chunks
        int16_array = np.random.randint(-32768, 32767, size=100, dtype=np.int16)
        pcm_bytes = int16_array.tobytes()
        pipeline.add_pcm_chunk(pcm_bytes, is_final=True)
        
        # Verify state before clear
        assert pipeline.get_buffer_size() > 0
        assert pipeline.should_process()
        
        # Clear buffer
        pipeline.clear_buffer()
        
        # Verify state after clear
        assert pipeline.get_buffer_size() == 0
        assert not pipeline.should_process()
    
    def test_should_process_timeout_trigger(self):
        """Test that buffer duration timeout triggers should_process."""
        pipeline = AudioPipeline(max_buffer_duration=0.1)  # 100ms timeout
        
        # Add chunk
        int16_array = np.random.randint(-32768, 32767, size=100, dtype=np.int16)
        pcm_bytes = int16_array.tobytes()
        pipeline.add_pcm_chunk(pcm_bytes)
        
        # Should not process immediately
        assert not pipeline.should_process()
        
        # Wait for timeout
        time.sleep(0.15)
        
        # Should process after timeout
        assert pipeline.should_process()
    
    def test_pcm_concatenation_multiple_chunks(self):
        """Test that multiple PCM chunks concatenate correctly."""
        pipeline = AudioPipeline()
        
        # Create known PCM data
        chunk1 = np.array([100, 200, 300], dtype=np.int16).tobytes()
        chunk2 = np.array([400, 500, 600], dtype=np.int16).tobytes()
        chunk3 = np.array([700, 800, 900], dtype=np.int16).tobytes()
        
        # Add chunks
        pipeline.add_pcm_chunk(chunk1)
        pipeline.add_pcm_chunk(chunk2)
        pipeline.add_pcm_chunk(chunk3)
        
        # Get audio
        float32_array = pipeline.get_audio_for_asr()
        
        # Verify concatenation
        assert len(float32_array) == 9  # 3 + 3 + 3 samples
        
        # Verify values (approximate due to float conversion)
        expected = np.array([100, 200, 300, 400, 500, 600, 700, 800, 900], dtype=np.float32) / 32768.0
        np.testing.assert_array_almost_equal(float32_array, expected, decimal=5)


class TestAudioPipelineIntegration:
    """Integration tests for AudioPipeline with realistic scenarios."""
    
    def test_realistic_audio_flow(self):
        """Test realistic audio flow: accumulate chunks, process, clear."""
        pipeline = AudioPipeline()
        
        # Simulate receiving 10 audio chunks
        for i in range(10):
            # Each chunk is 20ms at 16kHz = 320 samples = 640 bytes
            int16_array = np.random.randint(-32768, 32767, size=320, dtype=np.int16)
            pcm_bytes = int16_array.tobytes()
            is_final = (i == 9)  # Last chunk triggers VAD
            pipeline.add_pcm_chunk(pcm_bytes, is_final=is_final)
        
        # Should process after final chunk
        assert pipeline.should_process()
        assert pipeline.get_buffer_size() == 6400  # 10 chunks * 640 bytes
        
        # Get audio for ASR
        float32_array = pipeline.get_audio_for_asr()
        assert len(float32_array) == 3200  # 10 chunks * 320 samples
        assert float32_array.dtype == np.float32
        
        # Clear buffer
        pipeline.clear_buffer()
        assert pipeline.get_buffer_size() == 0
        assert not pipeline.should_process()
    
    def test_continuous_speech_timeout_fallback(self):
        """Test timeout fallback for continuous speech without VAD trigger."""
        pipeline = AudioPipeline(max_buffer_duration=0.2)  # 200ms timeout
        
        # Add chunks without is_final (continuous speech)
        for i in range(5):
            int16_array = np.random.randint(-32768, 32767, size=320, dtype=np.int16)
            pcm_bytes = int16_array.tobytes()
            pipeline.add_pcm_chunk(pcm_bytes, is_final=False)
            time.sleep(0.05)  # 50ms between chunks
        
        # Should process due to timeout (5 * 50ms = 250ms > 200ms)
        assert pipeline.should_process()
