"""Property-based tests for preservation of existing behavior during PCM migration.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

These tests ensure that the PCM migration doesn't break existing functionality:
- VAD-triggered buffer flush (is_final=True)
- Timeout fallback (25-second threshold)
- Buffer size limits (10MB max buffer, 1MB max chunk)
- Rate limiting (100 chunks/sec)
- Transcript message format

These tests should PASS on the UNFIXED code (current WebM implementation) and
continue to PASS after the PCM migration, confirming no regressions.
"""

import base64
import time
from unittest.mock import AsyncMock, Mock

import pytest
from hypothesis import given, strategies as st, settings, HealthCheck

from app.infrastructure.asr.audio_pipeline import (
    AudioPipeline,
    BufferOverflowError,
    ChunkSizeError,
)
from app.presentation.ws.voice_mode_handler import VoiceModeHandler


# Strategy for generating valid PCM audio chunks
@st.composite
def pcm_chunk_strategy(draw, min_size=10, max_size=1000):
    """Generate valid PCM audio chunks (raw bytes)."""
    # Generate random bytes for PCM audio data (must be even number for Int16)
    size = draw(st.integers(min_value=min_size, max_value=max_size))
    # Ensure size is even (Int16 requires 2 bytes per sample)
    if size % 2 != 0:
        size += 1
    audio_bytes = draw(st.binary(min_size=size, max_size=size))
    
    return audio_bytes


class TestVADTriggerPreservation:
    """Property 2.1: VAD trigger behavior is preserved.
    
    **Validates: Requirement 3.1**
    
    WHEN the VAD (Voice Activity Detection) triggers a flush (is_final=True)
    THEN the system SHALL CONTINUE TO process accumulated audio buffer and send it to ASR.
    """
    
    @given(num_chunks=st.integers(min_value=1, max_value=50))
    @settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_vad_trigger_causes_buffer_flush(self, num_chunks):
        """Property: is_final=True always triggers buffer flush (should_process=True).
        
        For any number of audio chunks, when the final chunk has is_final=True,
        the pipeline should indicate it's ready to process.
        """
        pipeline = AudioPipeline()
        
        # Add chunks without is_final
        for i in range(num_chunks - 1):
            audio_data = f"chunk{i}".encode()
            # Ensure even length for Int16 PCM
            if len(audio_data) % 2 != 0:
                audio_data += b"\x00"
            pipeline.add_pcm_chunk(audio_data, is_final=False)
            
            # should_process should be False until final chunk
            assert not pipeline.should_process(), \
                f"should_process should be False before final chunk (chunk {i+1}/{num_chunks})"
        
        # Add final chunk with is_final=True
        audio_data = f"chunk{num_chunks-1}".encode()
        if len(audio_data) % 2 != 0:
            audio_data += b"\x00"
        pipeline.add_pcm_chunk(audio_data, is_final=True)
        
        # should_process MUST return True after is_final=True
        assert pipeline.should_process(), \
            "should_process MUST return True when is_final=True is received"
    
    @given(
        num_non_final=st.integers(min_value=0, max_value=20),
        num_after_final=st.integers(min_value=0, max_value=10)
    )
    @settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_vad_flag_persists_after_set(self, num_non_final, num_after_final):
        """Property: Once is_final=True is set, should_process remains True.
        
        The final flag should persist even if more non-final chunks are added.
        """
        pipeline = AudioPipeline()
        
        # Add non-final chunks
        for i in range(num_non_final):
            audio_data = f"chunk{i}".encode()
            if len(audio_data) % 2 != 0:
                audio_data += b"\x00"
            pipeline.add_pcm_chunk(audio_data, is_final=False)
        
        # Add final chunk
        audio_data = b"final_chunk"
        if len(audio_data) % 2 != 0:
            audio_data += b"\x00"
        pipeline.add_pcm_chunk(audio_data, is_final=True)
        
        assert pipeline.should_process(), "should_process must be True after is_final=True"
        
        # Add more non-final chunks
        for i in range(num_after_final):
            audio_data = f"after{i}".encode()
            if len(audio_data) % 2 != 0:
                audio_data += b"\x00"
            pipeline.add_pcm_chunk(audio_data, is_final=False)
            
            # should_process should STILL be True
            assert pipeline.should_process(), \
                f"should_process must remain True after is_final was set (chunk {i+1}/{num_after_final})"


class TestTimeoutTriggerPreservation:
    """Property 2.2: Timeout trigger behavior is preserved.
    
    **Validates: Requirement 3.2**
    
    WHEN the 25-second timeout occurs without VAD trigger
    THEN the system SHALL CONTINUE TO flush the audio buffer as a fallback mechanism.
    """
    
    def test_timeout_threshold_triggers_flush(self):
        """Property: Buffer duration >= max_buffer_duration triggers flush.
        
        When buffer accumulation reaches the proactive flush threshold (25 seconds),
        should_process returns True even without is_final=True.
        """
        # Use short timeout for testing (0.1s instead of 25s)
        pipeline = AudioPipeline(
            buffer_timeout=0.2,
            max_buffer_duration=0.1
        )
        
        # Add first chunk
        audio_data = b"chunk1"
        if len(audio_data) % 2 != 0:
            audio_data += b"\x00"
        pipeline.add_pcm_chunk(audio_data, is_final=False)
        
        # Initially should_process is False
        assert not pipeline.should_process(), \
            "should_process should be False immediately after first chunk"
        
        # Wait for max_buffer_duration to be exceeded
        time.sleep(0.12)
        
        # should_process should now return True due to duration threshold
        assert pipeline.should_process(), \
            "should_process MUST return True when max_buffer_duration is exceeded"
    
    def test_timeout_threshold_value_is_25_seconds(self):
        """Property: Default max_buffer_duration is 25 seconds.
        
        Verify the timeout threshold is set to 25 seconds by default.
        """
        pipeline = AudioPipeline()
        
        assert pipeline.max_buffer_duration == 25.0, \
            "Default max_buffer_duration must be 25 seconds"
    
    def test_timeout_resets_after_clear(self):
        """Property: Timeout timer resets after buffer is cleared.
        
        After clearing the buffer, the timeout should reset and allow
        new chunks to be added without timeout errors.
        """
        pipeline = AudioPipeline(
            buffer_timeout=0.2,
            max_buffer_duration=0.1
        )
        
        # Add chunk and clear
        audio_data = b"chunk1"
        if len(audio_data) % 2 != 0:
            audio_data += b"\x00"
        pipeline.add_pcm_chunk(audio_data, is_final=False)
        pipeline.clear_buffer()
        
        # Wait past original timeout
        time.sleep(0.15)
        
        # Should be able to add new chunk (timeout was reset)
        audio_data = b"chunk2"
        if len(audio_data) % 2 != 0:
            audio_data += b"\x00"
        pipeline.add_pcm_chunk(audio_data, is_final=False)
        
        assert pipeline.get_buffer_size() == len(audio_data), \
            "New chunk should be added successfully after clear and timeout reset"


class TestBufferSizeLimitPreservation:
    """Property 2.3: Buffer size limits are preserved.
    
    **Validates: Requirement 3.4**
    
    WHEN audio is being captured
    THEN the system SHALL CONTINUE TO enforce buffer size limits.
    """
    
    @given(
        max_buffer_size=st.integers(min_value=1000, max_value=100000),
        chunk_size=st.integers(min_value=100, max_value=1000)
    )
    @settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_buffer_overflow_enforced(self, max_buffer_size, chunk_size):
        """Property: Buffer overflow is detected when total size exceeds limit.
        
        For any buffer size limit and chunk size, adding chunks that exceed
        the limit should raise BufferOverflowError.
        """
        # Ensure chunk_size is even for Int16 PCM
        if chunk_size % 2 != 0:
            chunk_size += 1
            
        pipeline = AudioPipeline(max_buffer_size=max_buffer_size)
        
        # Calculate how many chunks fit
        num_chunks_that_fit = max_buffer_size // chunk_size
        
        # Add chunks that fit
        for i in range(num_chunks_that_fit):
            audio_data = b"x" * chunk_size
            pipeline.add_pcm_chunk(audio_data, is_final=False)
        
        # Try to add one more chunk that would exceed limit
        audio_data = b"x" * chunk_size
        
        with pytest.raises(BufferOverflowError):
            pipeline.add_pcm_chunk(audio_data, is_final=False)
    
    def test_default_buffer_size_is_10mb(self):
        """Property: Default max_buffer_size is 10MB.
        
        Verify the buffer size limit is set to 10MB by default.
        """
        pipeline = AudioPipeline()
        
        assert pipeline.max_buffer_size == 10 * 1024 * 1024, \
            "Default max_buffer_size must be 10MB"
    
    @given(num_chunks=st.integers(min_value=1, max_value=20))
    @settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_total_size_matches_sum_of_chunks(self, num_chunks):
        """Property: Total size always equals sum of individual chunk sizes.
        
        The buffer's total size tracking should always be accurate.
        """
        pipeline = AudioPipeline()
        expected_total = 0
        
        for i in range(num_chunks):
            audio_data = f"chunk{i}".encode()
            # Ensure even length for Int16 PCM
            if len(audio_data) % 2 != 0:
                audio_data += b"\x00"
            pipeline.add_pcm_chunk(audio_data, is_final=False)
            
            expected_total += len(audio_data)
        
        assert pipeline.get_buffer_size() == expected_total, \
            "Total size must equal sum of all chunk sizes"


class TestChunkSizeLimitPreservation:
    """Property 2.4: Chunk size limits are preserved.
    
    **Validates: Requirement 3.4**
    
    WHEN audio chunks are received
    THEN the system SHALL CONTINUE TO enforce chunk size limits.
    """
    
    @given(
        max_chunk_size=st.integers(min_value=100, max_value=10000),
        oversized_by=st.integers(min_value=1, max_value=1000)
    )
    @settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_oversized_chunk_rejected(self, max_chunk_size, oversized_by):
        """Property: Chunks exceeding max_chunk_size are rejected.
        
        For any chunk size limit, chunks larger than the limit should
        raise ChunkSizeError.
        """
        # Ensure sizes are even for Int16 PCM
        if max_chunk_size % 2 != 0:
            max_chunk_size += 1
        if oversized_by % 2 != 0:
            oversized_by += 1
            
        pipeline = AudioPipeline(max_chunk_size=max_chunk_size)
        
        # Create chunk that exceeds limit
        oversized_data = b"x" * (max_chunk_size + oversized_by)
        
        with pytest.raises(ChunkSizeError):
            pipeline.add_pcm_chunk(oversized_data, is_final=False)
        
        # Buffer should remain empty after rejection
        assert pipeline.get_buffer_size() == 0, \
            "Buffer should remain empty after oversized chunk is rejected"
    
    def test_default_chunk_size_is_1mb(self):
        """Property: Default max_chunk_size is 1MB.
        
        Verify the chunk size limit is set to 1MB by default.
        """
        pipeline = AudioPipeline()
        
        assert pipeline.max_chunk_size == 1 * 1024 * 1024, \
            "Default max_chunk_size must be 1MB"
    
    @given(max_chunk_size=st.integers(min_value=100, max_value=10000))
    @settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_chunk_at_exact_limit_accepted(self, max_chunk_size):
        """Property: Chunks at exact size limit are accepted.
        
        Chunks that are exactly at the limit should be accepted.
        """
        # Ensure size is even for Int16 PCM
        if max_chunk_size % 2 != 0:
            max_chunk_size += 1
            
        pipeline = AudioPipeline(max_chunk_size=max_chunk_size)
        
        # Create chunk at exact limit
        data = b"x" * max_chunk_size
        
        pipeline.add_pcm_chunk(data, is_final=False)
        
        assert pipeline.get_buffer_size() == max_chunk_size, \
            "Chunk at exact size limit should be accepted"


class TestRateLimitPreservation:
    """Property 2.5: Rate limiting is preserved.
    
    **Validates: Requirement 3.4**
    
    WHEN audio chunks are received rapidly
    THEN the system SHALL CONTINUE TO enforce rate limits.
    """
    
    @pytest.mark.asyncio
    async def test_rate_limit_enforced(self):
        """Property: Rate limit of 100 chunks/sec is enforced.
        
        When chunks exceed the rate limit, RateLimitError should be raised.
        """
        # Create handler with rate limit
        websocket = AsyncMock()
        asr_service = Mock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            rate_limit_chunks=5,  # Low limit for testing
            rate_limit_window=1.0,
        )
        
        # Add chunks up to limit
        for i in range(5):
            audio_b64 = base64.b64encode(f"chunk{i}".encode()).decode()
            message = {"audio": audio_b64, "is_final": False}
            await handler.handle_audio_chunk(message)
        
        # Next chunk should trigger rate limit
        audio_b64 = base64.b64encode(b"overflow").decode()
        message = {"audio": audio_b64, "is_final": False}
        await handler.handle_audio_chunk(message)
        
        # Verify error was sent to client
        error_calls = [
            call for call in websocket.send_json.call_args_list
            if call[0][0].get("type") == "error" and 
            call[0][0].get("code") == "RATE_LIMIT_EXCEEDED"
        ]
        
        assert len(error_calls) > 0, \
            "Rate limit error should be sent to client when limit is exceeded"
    
    def test_default_rate_limit_is_100_per_second(self):
        """Property: Default rate limit is 100 chunks per second.
        
        Verify the rate limit is set to 100 chunks/sec by default.
        """
        websocket = AsyncMock()
        asr_service = Mock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        assert handler.rate_limit_chunks == 100, \
            "Default rate_limit_chunks must be 100"
        assert handler.rate_limit_window == 1.0, \
            "Default rate_limit_window must be 1.0 second"
    
    @pytest.mark.asyncio
    async def test_rate_limit_resets_after_window(self):
        """Property: Rate limit resets after the time window.
        
        After the rate limit window expires, new chunks should be accepted.
        """
        websocket = AsyncMock()
        asr_service = Mock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            rate_limit_chunks=3,
            rate_limit_window=0.1,  # 100ms window
        )
        
        # Add chunks up to limit
        for i in range(3):
            audio_b64 = base64.b64encode(f"chunk{i}".encode()).decode()
            message = {"audio": audio_b64, "is_final": False}
            await handler.handle_audio_chunk(message)
        
        # Wait for window to expire
        time.sleep(0.15)
        
        # Should be able to add more chunks now
        for i in range(3):
            audio_b64 = base64.b64encode(f"chunk_new{i}".encode()).decode()
            message = {"audio": audio_b64, "is_final": False}
            await handler.handle_audio_chunk(message)
        
        # Verify no rate limit errors were sent
        error_calls = [
            call for call in websocket.send_json.call_args_list
            if call[0][0].get("type") == "error" and 
            call[0][0].get("code") == "RATE_LIMIT_EXCEEDED"
        ]
        
        assert len(error_calls) == 0, \
            "No rate limit errors should occur after window resets"


class TestTranscriptFormatPreservation:
    """Property 2.6: Transcript message format is preserved.
    
    **Validates: Requirement 3.3**
    
    WHEN the ASR system processes audio
    THEN the system SHALL CONTINUE TO return transcription results via WebSocket
    with the same message schema.
    """
    
    @pytest.mark.asyncio
    async def test_transcript_message_schema(self):
        """Property: Transcript messages have consistent schema.
        
        Transcript messages should always include: type, session_id, text,
        confidence, language, and is_final fields.
        """
        websocket = AsyncMock()
        asr_service = Mock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Send transcript
        await handler.send_transcript(
            text="Hello world",
            confidence=0.95,
            language="en"
        )
        
        # Verify message was sent with correct schema
        assert websocket.send_json.called, "send_json should be called"
        
        sent_message = websocket.send_json.call_args[0][0]
        
        # Verify all required fields are present
        assert "type" in sent_message, "Message must have 'type' field"
        assert "session_id" in sent_message, "Message must have 'session_id' field"
        assert "text" in sent_message, "Message must have 'text' field"
        assert "confidence" in sent_message, "Message must have 'confidence' field"
        assert "language" in sent_message, "Message must have 'language' field"
        assert "is_final" in sent_message, "Message must have 'is_final' field"
        
        # Verify field values
        assert sent_message["type"] == "transcript", "Type must be 'transcript'"
        assert sent_message["session_id"] == "test-session-123", "Session ID must match"
        assert sent_message["text"] == "Hello world", "Text must match"
        assert sent_message["confidence"] == 0.95, "Confidence must match"
        assert sent_message["language"] == "en", "Language must match"
        assert sent_message["is_final"] is True, "is_final must be True"
    
    @pytest.mark.asyncio
    @given(
        text=st.text(min_size=1, max_size=500),
        confidence=st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False),
        language=st.sampled_from(["en", "ar", "fr", "es", "de"])
    )
    @settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
    async def test_transcript_format_with_various_inputs(self, text, confidence, language):
        """Property: Transcript format is consistent for all valid inputs.
        
        For any valid text, confidence, and language, the transcript message
        should maintain the same schema.
        """
        websocket = AsyncMock()
        asr_service = Mock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        await handler.send_transcript(
            text=text,
            confidence=confidence,
            language=language
        )
        
        sent_message = websocket.send_json.call_args[0][0]
        
        # Verify schema is preserved
        assert sent_message["type"] == "transcript"
        assert sent_message["text"] == text
        assert sent_message["confidence"] == confidence
        assert sent_message["language"] == language
        assert sent_message["is_final"] is True
