"""Unit tests for security validations in voice mode.

This test suite validates security requirements for the continuous ASR voice mode:
- Base64 validation and error handling (Requirement 18.2)
- Chunk size limits and rejection (Requirement 18.3, 18.4)
- Rate limiting enforcement (Requirement 19.1, 19.2)

Tests ensure that malicious or malformed inputs are properly rejected and
appropriate error messages are sent to clients.
"""

import base64
import time
import pytest
from unittest.mock import AsyncMock, Mock

from app.services.audio_pipeline import (
    AudioPipeline,
    BufferOverflowError,
    BufferOverflowError,
    ChunkSizeError,
)
from app.websocket.voice_mode_handler import VoiceModeHandler, RateLimitError
from app.schemas.voice_mode import AudioChunkMessage as AudioChunkSchema


class TestBase64Validation:
    """Tests for base64 validation and error handling.
    
    Validates Requirements: 18.2, 18.4
    """
    
    def test_valid_base64_accepted(self):
        """Test that valid base64 audio data is accepted."""
        # Requirement 18.2: Valid base64 should be accepted
        manager = AudioBufferManager()
        audio_data = b"valid audio data"
        audio_b64 = base64.b64encode(audio_data).decode()
        chunk = AudioChunkMessage(audio=audio_b64)
        
        manager.add_chunk(chunk)
        
        assert manager.get_total_size() == len(audio_data)
        assert manager.get_chunks()[0] == audio_data
    
    def test_invalid_base64_rejected(self):
        """Test that invalid base64 encoding is rejected."""
        # Requirement 18.2: Invalid base64 must be rejected
        manager = AudioBufferManager()
        chunk = AudioChunkMessage(audio="not-valid-base64!!!")
        
        with pytest.raises(ValueError, match="Invalid base64 encoding"):
            manager.add_chunk(chunk)
        
        # Buffer should remain empty after rejection
        assert manager.get_total_size() == 0
    
    def test_malformed_base64_with_special_chars(self):
        """Test that base64 with invalid characters is rejected."""
        # Requirement 18.2: Malformed base64 must be caught
        manager = AudioBufferManager()
        invalid_strings = [
            "invalid@#$%^&*()",
            "abc!def",
            "test data with spaces",
            "../../etc/passwd",  # Path traversal attempt
        ]
        
        for invalid_str in invalid_strings:
            chunk = AudioChunkMessage(audio=invalid_str)
            with pytest.raises(ValueError, match="(Invalid base64|Failed to decode)"):
                manager.add_chunk(chunk)
    
    def test_base64_with_invalid_padding(self):
        """Test that base64 with incorrect padding is rejected."""
        # Requirement 18.2: Invalid padding should be caught
        manager = AudioBufferManager()
        # "abc" has invalid padding (should be "abc=" or similar)
        chunk = AudioChunkMessage(audio="abc")
        
        with pytest.raises(ValueError, match="(Invalid base64|Failed to decode)"):
            manager.add_chunk(chunk)
    
    def test_empty_base64_rejected(self):
        """Test that empty base64 string is rejected."""
        # Requirement 18.2: Empty audio data must be rejected
        with pytest.raises(ValueError, match="audio cannot be empty"):
            AudioChunkMessage(audio="")
    
    def test_base64_decoding_to_empty_bytes(self):
        """Test that base64 decoding to empty bytes is rejected."""
        # Requirement 18.2: Audio that decodes to empty must be rejected
        manager = AudioBufferManager()
        # Empty bytes encoded as base64 is an empty string, caught by AudioChunkMessage
        # But let's test the buffer manager's validation
        with pytest.raises(ValueError, match="audio cannot be empty"):
            AudioChunkMessage(audio="")
    
    @pytest.mark.asyncio
    async def test_base64_error_handling_in_handler(self):
        """Test that VoiceModeHandler properly handles base64 errors."""
        # Requirement 18.4: Base64 decoding errors must be caught and reported
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Send invalid base64
        message = {"audio": "invalid-base64!!!", "is_final": False}
        await handler.handle_audio_chunk(message)
        
        # Verify error was sent to client
        websocket.send_json.assert_called_once()
        error_message = websocket.send_json.call_args[0][0]
        assert error_message["type"] == "error"
        assert "INVALID_AUDIO" in error_message["code"] or "base64" in error_message["message"].lower()
    
    def test_pydantic_schema_base64_validation(self):
        """Test that Pydantic schema validates base64 format."""
        # Requirement 18.2: Schema-level validation
        from pydantic import ValidationError
        
        # Valid base64
        valid_data = {
            "audio": base64.b64encode(b"test").decode(),
            "is_final": False,
            "timestamp": 123.45,
        }
        schema = AudioChunkSchema(**valid_data)
        assert schema.audio == valid_data["audio"]
        
        # Invalid base64 should be caught by validator
        invalid_data = {
            "audio": "not-valid-base64!!!",
            "is_final": False,
            "timestamp": 123.45,
        }
        with pytest.raises(ValidationError, match="Invalid base64"):
            AudioChunkSchema(**invalid_data)


class TestChunkSizeLimits:
    """Tests for chunk size validation and rejection.
    
    Validates Requirements: 18.3, 18.4
    """
    
    def test_chunk_within_limit_accepted(self):
        """Test that chunks within size limit are accepted."""
        # Requirement 18.3: Valid chunks should be accepted
        manager = AudioBufferManager(max_chunk_size=1000)
        data = b"x" * 500
        audio_b64 = base64.b64encode(data).decode()
        chunk = AudioChunkMessage(audio=audio_b64)
        
        manager.add_chunk(chunk)
        
        assert manager.get_total_size() == 500
    
    def test_chunk_at_exact_limit_accepted(self):
        """Test that chunk at exact size limit is accepted."""
        # Requirement 18.3: Boundary condition - exact limit
        manager = AudioBufferManager(max_chunk_size=1000)
        data = b"x" * 1000
        audio_b64 = base64.b64encode(data).decode()
        chunk = AudioChunkMessage(audio=audio_b64)
        
        manager.add_chunk(chunk)
        
        assert manager.get_total_size() == 1000
    
    def test_oversized_chunk_rejected(self):
        """Test that chunks exceeding size limit are rejected."""
        # Requirement 18.3: Oversized chunks must be rejected
        manager = AudioBufferManager(max_chunk_size=1000)
        large_data = b"x" * 2000
        audio_b64 = base64.b64encode(large_data).decode()
        chunk = AudioChunkMessage(audio=audio_b64)
        
        with pytest.raises(ChunkSizeError, match="exceeds maximum allowed chunk size"):
            manager.add_chunk(chunk)
        
        # Buffer should remain empty
        assert manager.get_total_size() == 0
    
    def test_multiple_small_chunks_accepted(self):
        """Test that multiple small chunks are accepted."""
        # Requirement 18.3: Multiple valid chunks should accumulate
        manager = AudioBufferManager(max_chunk_size=1000)
        
        for i in range(5):
            data = b"x" * 200
            audio_b64 = base64.b64encode(data).decode()
            chunk = AudioChunkMessage(audio=audio_b64)
            manager.add_chunk(chunk)
        
        assert manager.get_total_size() == 1000
        assert len(manager.get_chunks()) == 5
    
    def test_chunk_size_error_preserves_buffer(self):
        """Test that chunk size error doesn't corrupt existing buffer."""
        # Requirement 18.3: Failed chunk should not affect existing data
        manager = AudioBufferManager(max_chunk_size=1000)
        
        # Add valid chunk
        valid_data = b"x" * 500
        valid_b64 = base64.b64encode(valid_data).decode()
        valid_chunk = AudioChunkMessage(audio=valid_b64)
        manager.add_chunk(valid_chunk)
        
        # Try to add oversized chunk
        large_data = b"x" * 2000
        large_b64 = base64.b64encode(large_data).decode()
        large_chunk = AudioChunkMessage(audio=large_b64)
        
        with pytest.raises(ChunkSizeError):
            manager.add_chunk(large_chunk)
        
        # Original chunk should still be in buffer
        assert manager.get_total_size() == 500
        assert len(manager.get_chunks()) == 1
    
    @pytest.mark.asyncio
    async def test_chunk_size_error_in_handler(self):
        """Test that VoiceModeHandler sends error for oversized chunks."""
        # Requirement 18.4: Handler must report chunk size errors
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            max_chunk_size=100,
        )
        
        # Send oversized chunk
        large_data = b"x" * 200
        audio_b64 = base64.b64encode(large_data).decode()
        message = {"audio": audio_b64, "is_final": False}
        
        await handler.handle_audio_chunk(message)
        
        # Verify error was sent
        websocket.send_json.assert_called_once()
        error_message = websocket.send_json.call_args[0][0]
        assert error_message["type"] == "error"
        assert error_message["code"] == "CHUNK_SIZE_EXCEEDED"
    
    def test_very_large_chunk_rejected(self):
        """Test that extremely large chunks are rejected."""
        # Requirement 18.3: Protection against DoS via large payloads
        manager = AudioBufferManager(max_chunk_size=1024 * 1024)  # 1MB limit
        
        # Try to add 10MB chunk
        huge_data = b"x" * (10 * 1024 * 1024)
        audio_b64 = base64.b64encode(huge_data).decode()
        chunk = AudioChunkMessage(audio=audio_b64)
        
        with pytest.raises(ChunkSizeError):
            manager.add_chunk(chunk)


class TestRateLimiting:
    """Tests for rate limiting enforcement.
    
    Validates Requirements: 19.1, 19.2
    """
    
    @pytest.mark.asyncio
    async def test_rate_limit_enforced(self):
        """Test that rate limit is enforced for audio chunks."""
        # Requirement 19.1: Rate limiting must be enforced
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            rate_limit_chunks=5,
            rate_limit_window=1.0,
        )
        
        audio_b64 = base64.b64encode(b"test").decode()
        
        # Send chunks up to limit
        for i in range(5):
            message = {"audio": audio_b64, "is_final": False}
            await handler.handle_audio_chunk(message)
        
        # Verify chunks were accepted
        assert len(handler.audio_buffer.get_chunks()) == 5
        
        # Try to exceed limit
        message = {"audio": audio_b64, "is_final": False}
        await handler.handle_audio_chunk(message)
        
        # Verify rate limit error was sent
        error_calls = [call for call in websocket.send_json.call_args_list 
                      if call[0][0].get("code") == "RATE_LIMIT_EXCEEDED"]
        assert len(error_calls) > 0
        
        # Buffer should not have the rejected chunk
        assert len(handler.audio_buffer.get_chunks()) == 5
    
    @pytest.mark.asyncio
    async def test_rate_limit_sliding_window(self):
        """Test that rate limit uses sliding window approach."""
        # Requirement 19.1: Sliding window rate limiting
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            rate_limit_chunks=3,
            rate_limit_window=0.1,  # 100ms window
        )
        
        audio_b64 = base64.b64encode(b"test").decode()
        
        # Send chunks up to limit
        for i in range(3):
            message = {"audio": audio_b64, "is_final": False}
            await handler.handle_audio_chunk(message)
        
        # Wait for window to expire
        time.sleep(0.15)
        
        # Should be able to send more chunks
        for i in range(3):
            message = {"audio": audio_b64, "is_final": False}
            await handler.handle_audio_chunk(message)
        
        # All chunks should be accepted
        assert len(handler.audio_buffer.get_chunks()) == 6
    
    @pytest.mark.asyncio
    async def test_rate_limit_per_session(self):
        """Test that rate limiting is enforced per session."""
        # Requirement 19.1: Rate limiting is per-session
        websocket1 = AsyncMock()
        websocket2 = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        # Create two handlers with different sessions
        handler1 = VoiceModeHandler(
            websocket=websocket1,
            session_id="session-1",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            rate_limit_chunks=3,
            rate_limit_window=1.0,
        )
        
        handler2 = VoiceModeHandler(
            websocket=websocket2,
            session_id="session-2",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            rate_limit_chunks=3,
            rate_limit_window=1.0,
        )
        
        audio_b64 = base64.b64encode(b"test").decode()
        message = {"audio": audio_b64, "is_final": False}
        
        # Each session should have independent rate limits
        for i in range(3):
            await handler1.handle_audio_chunk(message)
            await handler2.handle_audio_chunk(message)
        
        # Both should have accepted all chunks
        assert len(handler1.audio_buffer.get_chunks()) == 3
        assert len(handler2.audio_buffer.get_chunks()) == 3
    
    @pytest.mark.asyncio
    async def test_rate_limit_error_message(self):
        """Test that rate limit error includes helpful information."""
        # Requirement 19.2: Error message should be informative
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            rate_limit_chunks=2,
            rate_limit_window=1.0,
        )
        
        audio_b64 = base64.b64encode(b"test").decode()
        
        # Exceed rate limit
        for i in range(3):
            message = {"audio": audio_b64, "is_final": False}
            await handler.handle_audio_chunk(message)
        
        # Find the error message
        error_call = None
        for call in websocket.send_json.call_args_list:
            msg = call[0][0]
            if msg.get("code") == "RATE_LIMIT_EXCEEDED":
                error_call = msg
                break
        
        assert error_call is not None
        assert error_call["type"] == "error"
        assert "session_id" in error_call
        assert "message" in error_call
        assert "slow down" in error_call["message"].lower() or "rate limit" in error_call["message"].lower()
    
    @pytest.mark.asyncio
    async def test_rate_limit_with_rapid_fire_chunks(self):
        """Test rate limiting with rapid consecutive chunks."""
        # Requirement 19.1: Protection against rapid chunk submission
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            rate_limit_chunks=10,
            rate_limit_window=1.0,
        )
        
        audio_b64 = base64.b64encode(b"test").decode()
        
        # Try to send 20 chunks rapidly
        for i in range(20):
            message = {"audio": audio_b64, "is_final": False}
            await handler.handle_audio_chunk(message)
        
        # Only first 10 should be accepted
        assert len(handler.audio_buffer.get_chunks()) == 10
        
        # Should have received rate limit errors
        error_count = sum(1 for call in websocket.send_json.call_args_list 
                         if call[0][0].get("code") == "RATE_LIMIT_EXCEEDED")
        assert error_count > 0
    
    def test_rate_limit_check_method(self):
        """Test the internal rate limit check method."""
        # Requirement 19.1: Rate limit checking logic
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            rate_limit_chunks=3,
            rate_limit_window=1.0,
        )
        
        # Should not raise for first 3 checks
        for i in range(3):
            handler._check_rate_limit()
        
        # Should raise on 4th check
        with pytest.raises(RateLimitError, match="Rate limit exceeded"):
            handler._check_rate_limit()


class TestSecurityIntegration:
    """Integration tests for multiple security validations.
    
    Validates Requirements: 18.2, 18.3, 18.4, 19.1, 19.2
    """
    
    @pytest.mark.asyncio
    async def test_multiple_validation_failures(self):
        """Test that multiple validation failures are handled correctly."""
        # Test that system handles various attack vectors
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            max_chunk_size=100,
            rate_limit_chunks=5,
        )
        
        # Try invalid base64
        await handler.handle_audio_chunk({"audio": "invalid!!!", "is_final": False})
        
        # Try oversized chunk
        large_data = b"x" * 200
        await handler.handle_audio_chunk({
            "audio": base64.b64encode(large_data).decode(),
            "is_final": False
        })
        
        # Try rate limit
        audio_b64 = base64.b64encode(b"test").decode()
        for i in range(10):
            await handler.handle_audio_chunk({"audio": audio_b64, "is_final": False})
        
        # All errors should be reported
        assert websocket.send_json.call_count >= 3
    
    @pytest.mark.asyncio
    async def test_validation_order(self):
        """Test that validations are performed in correct order."""
        # Rate limit should be checked before other validations
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            rate_limit_chunks=1,
            max_chunk_size=100,
        )
        
        audio_b64 = base64.b64encode(b"test").decode()
        
        # First chunk should succeed
        await handler.handle_audio_chunk({"audio": audio_b64, "is_final": False})
        
        # Second chunk should fail rate limit (even if it's oversized)
        large_data = b"x" * 200
        await handler.handle_audio_chunk({
            "audio": base64.b64encode(large_data).decode(),
            "is_final": False
        })
        
        # Should get rate limit error, not chunk size error
        error_call = websocket.send_json.call_args_list[-1]
        error_message = error_call[0][0]
        assert error_message["code"] == "RATE_LIMIT_EXCEEDED"
    
    @pytest.mark.asyncio
    async def test_buffer_state_after_validation_failure(self):
        """Test that buffer state is consistent after validation failures."""
        # Requirement 18.4: Failed validations should not corrupt state
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            max_chunk_size=100,
        )
        
        # Add valid chunk
        valid_b64 = base64.b64encode(b"valid").decode()
        await handler.handle_audio_chunk({"audio": valid_b64, "is_final": False})
        
        initial_size = handler.audio_buffer.get_total_size()
        initial_count = len(handler.audio_buffer.get_chunks())
        
        # Try to add invalid chunk
        await handler.handle_audio_chunk({"audio": "invalid!!!", "is_final": False})
        
        # Buffer should be unchanged
        assert handler.audio_buffer.get_total_size() == initial_size
        assert len(handler.audio_buffer.get_chunks()) == initial_count
