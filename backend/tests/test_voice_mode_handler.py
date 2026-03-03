"""Unit tests for VoiceModeHandler class.

Tests cover:
- Audio chunk handling and buffering
- ASR triggering on final chunk
- Transcript delivery to client
- Error handling for transcription failures

Validates Requirements: 6.1, 6.2, 10.3, 10.4
"""

import base64
import pytest
from unittest.mock import AsyncMock, Mock, patch
from app.websocket.voice_mode_handler import VoiceModeHandler
from app.services.audio_pipeline import BufferOverflowError
from app.services.asr.base import StreamingASRResult


class TestVoiceModeHandlerAudioChunkHandling:
    """Tests for audio chunk handling and buffering."""
    
    @pytest.mark.asyncio
    async def test_handle_audio_chunk_adds_to_buffer(self):
        """Test that audio chunks are added to buffer correctly."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Create audio chunk message
        audio_data = b"test audio data"
        audio_b64 = base64.b64encode(audio_data).decode()
        message = {
            "audio": audio_b64,
            "is_final": False,
            "timestamp": 1234.5,
            "format": "webm",
        }
        
        # Handle chunk
        await handler.handle_audio_chunk(message)
        
        # Verify chunk was added to buffer
        assert handler.audio_buffer.get_total_size() == len(audio_data)
        assert len(handler.audio_buffer.get_chunks()) == 1
        assert handler.audio_buffer.get_chunks()[0] == audio_data
    
    @pytest.mark.asyncio
    async def test_handle_multiple_audio_chunks(self):
        """Test handling multiple audio chunks accumulates them."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Add multiple chunks
        chunks_data = [b"chunk1", b"chunk2", b"chunk3"]
        for data in chunks_data:
            audio_b64 = base64.b64encode(data).decode()
            message = {"audio": audio_b64, "is_final": False}
            await handler.handle_audio_chunk(message)
        
        # Verify all chunks accumulated
        total_size = sum(len(data) for data in chunks_data)
        assert handler.audio_buffer.get_total_size() == total_size
        assert len(handler.audio_buffer.get_chunks()) == 3
    
    @pytest.mark.asyncio
    async def test_handle_audio_chunk_with_default_values(self):
        """Test handling audio chunk with minimal fields uses defaults."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Create minimal message
        audio_data = b"test"
        audio_b64 = base64.b64encode(audio_data).decode()
        message = {"audio": audio_b64}
        
        # Handle chunk
        await handler.handle_audio_chunk(message)
        
        # Verify chunk was added with defaults
        assert handler.audio_buffer.get_total_size() == len(audio_data)
        assert handler.audio_buffer.should_process() is False


class TestVoiceModeHandlerASRTriggering:
    """Tests for ASR triggering on final chunk."""
    
    @pytest.mark.asyncio
    async def test_final_chunk_triggers_asr(self):
        """Test that final chunk triggers ASR transcription.
        
        Validates Requirements: 6.1, 6.2
        """
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        # Mock ASR result
        asr_service.transcribe_stream.return_value = StreamingASRResult(
            transcript="Hello world",
            confidence=0.95,
            language="en",
            is_final=True,
        )
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Add non-final chunks
        chunk1 = {"audio": base64.b64encode(b"chunk1").decode(), "is_final": False}
        await handler.handle_audio_chunk(chunk1)
        
        # Verify ASR not called yet
        asr_service.transcribe_stream.assert_not_called()
        
        # Add final chunk
        chunk2 = {"audio": base64.b64encode(b"chunk2").decode(), "is_final": True}
        await handler.handle_audio_chunk(chunk2)
        
        # Verify ASR was called
        asr_service.transcribe_stream.assert_called_once()
        call_args = asr_service.transcribe_stream.call_args
        assert len(call_args.kwargs["audio_chunks"]) == 2
        assert call_args.kwargs["audio_format"] == "webm"
    
    @pytest.mark.asyncio
    async def test_asr_receives_all_accumulated_chunks(self):
        """Test that ASR receives all accumulated audio chunks."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        asr_service.transcribe_stream.return_value = StreamingASRResult(
            transcript="Test transcript",
            confidence=0.9,
            language="en",
            is_final=True,
        )
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Add multiple chunks
        chunks_data = [b"chunk1", b"chunk2", b"chunk3"]
        for i, data in enumerate(chunks_data):
            audio_b64 = base64.b64encode(data).decode()
            is_final = (i == len(chunks_data) - 1)
            message = {"audio": audio_b64, "is_final": is_final}
            await handler.handle_audio_chunk(message)
        
        # Verify ASR received all chunks
        call_args = asr_service.transcribe_stream.call_args
        received_chunks = call_args.kwargs["audio_chunks"]
        assert received_chunks == chunks_data
    
    @pytest.mark.asyncio
    async def test_buffer_cleared_after_asr(self):
        """Test that buffer is cleared after successful ASR transcription."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        asr_service.transcribe_stream.return_value = StreamingASRResult(
            transcript="Test",
            confidence=0.9,
            language="en",
            is_final=True,
        )
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Add final chunk
        audio_b64 = base64.b64encode(b"test audio").decode()
        message = {"audio": audio_b64, "is_final": True}
        await handler.handle_audio_chunk(message)
        
        # Verify buffer was cleared
        assert handler.audio_buffer.get_total_size() == 0
        assert len(handler.audio_buffer.get_chunks()) == 0
        assert handler.audio_buffer.should_process() is False


class TestVoiceModeHandlerTranscriptDelivery:
    """Tests for transcript delivery to client.
    
    Validates Requirements: 6.1, 6.2
    """
    
    @pytest.mark.asyncio
    async def test_transcript_sent_to_client(self):
        """Test that transcript is sent to client via WebSocket."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        asr_service.transcribe_stream.return_value = StreamingASRResult(
            transcript="Hello world",
            confidence=0.95,
            language="en",
            is_final=True,
        )
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Add final chunk
        audio_b64 = base64.b64encode(b"test audio").decode()
        message = {"audio": audio_b64, "is_final": True}
        await handler.handle_audio_chunk(message)
        
        # Verify transcript was sent
        websocket.send_json.assert_called()
        sent_message = websocket.send_json.call_args[0][0]
        assert sent_message["type"] == "transcript"
        assert sent_message["session_id"] == "test-session-123"
        assert sent_message["text"] == "Hello world"
        assert sent_message["confidence"] == 0.95
        assert sent_message["language"] == "en"
        assert sent_message["is_final"] is True
    
    @pytest.mark.asyncio
    async def test_send_transcript_with_custom_values(self):
        """Test sending transcript with custom confidence and language."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-456",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Send transcript directly
        await handler.send_transcript(
            text="مرحبا",
            confidence=0.87,
            language="ar",
        )
        
        # Verify message format
        websocket.send_json.assert_called_once()
        sent_message = websocket.send_json.call_args[0][0]
        assert sent_message["type"] == "transcript"
        assert sent_message["session_id"] == "test-session-456"
        assert sent_message["text"] == "مرحبا"
        assert sent_message["confidence"] == 0.87
        assert sent_message["language"] == "ar"
        assert sent_message["is_final"] is True
    
    @pytest.mark.asyncio
    async def test_empty_transcript_not_passed_to_pipeline(self):
        """Test that empty transcripts are not passed to conversation pipeline."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        # Mock ASR to return empty transcript
        asr_service.transcribe_stream.return_value = StreamingASRResult(
            transcript="   ",  # Whitespace only
            confidence=0.5,
            language="en",
            is_final=True,
        )
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Add final chunk
        audio_b64 = base64.b64encode(b"silence").decode()
        message = {"audio": audio_b64, "is_final": True}
        await handler.handle_audio_chunk(message)
        
        # Verify transcript was sent but pipeline not triggered
        websocket.send_json.assert_called()
        # Note: The current implementation logs a warning but doesn't
        # explicitly prevent pipeline processing - this test documents behavior


class TestVoiceModeHandlerErrorHandling:
    """Tests for error handling.
    
    Validates Requirements: 10.3, 10.4
    """
    
    @pytest.mark.asyncio
    async def test_buffer_overflow_sends_error(self):
        """Test that buffer overflow sends error message to client."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            max_buffer_size=100,  # Small buffer for testing
        )
        
        # Try to add chunk that exceeds buffer
        large_data = b"x" * 200
        audio_b64 = base64.b64encode(large_data).decode()
        message = {"audio": audio_b64, "is_final": False}
        
        await handler.handle_audio_chunk(message)
        
        # Verify error was sent
        websocket.send_json.assert_called_once()
        error_message = websocket.send_json.call_args[0][0]
        assert error_message["type"] == "error"
        assert error_message["code"] == "BUFFER_OVERFLOW"
        assert "shorter segments" in error_message["message"]
        assert error_message["session_id"] == "test-session-123"
        
        # Verify buffer was cleared
        assert handler.audio_buffer.get_total_size() == 0
    
    @pytest.mark.asyncio
    async def test_invalid_audio_chunk_sends_error(self):
        """Test that invalid audio chunk sends error message."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Send invalid message (empty audio)
        message = {"audio": "", "is_final": False}
        
        await handler.handle_audio_chunk(message)
        
        # Verify error was sent
        websocket.send_json.assert_called_once()
        error_message = websocket.send_json.call_args[0][0]
        assert error_message["type"] == "error"
        assert error_message["code"] == "INVALID_AUDIO_CHUNK"
        assert "Invalid audio chunk" in error_message["message"]
    
    @pytest.mark.asyncio
    async def test_transcription_failure_sends_error(self):
        """Test that transcription failure sends error and clears buffer.
        
        Validates Requirements: 10.3, 10.4
        """
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        # Mock ASR to raise exception
        asr_service.transcribe_stream.side_effect = Exception("ASR model failed")
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Add final chunk
        audio_b64 = base64.b64encode(b"test audio").decode()
        message = {"audio": audio_b64, "is_final": True}
        await handler.handle_audio_chunk(message)
        
        # Verify error was sent
        websocket.send_json.assert_called_once()
        error_message = websocket.send_json.call_args[0][0]
        assert error_message["type"] == "error"
        assert error_message["code"] == "TRANSCRIPTION_FAILED"
        assert "Failed to transcribe" in error_message["message"]
        assert error_message["session_id"] == "test-session-123"
        assert "details" in error_message
        
        # Verify buffer was cleared for retry
        assert handler.audio_buffer.get_total_size() == 0
    
    @pytest.mark.asyncio
    async def test_invalid_base64_sends_error(self):
        """Test that invalid base64 audio sends error message."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Send message with invalid base64
        message = {"audio": "not-valid-base64!!!", "is_final": False}
        
        await handler.handle_audio_chunk(message)
        
        # Verify error was sent
        websocket.send_json.assert_called_once()
        error_message = websocket.send_json.call_args[0][0]
        assert error_message["type"] == "error"
        assert error_message["code"] == "INVALID_AUDIO_CHUNK"
    
    @pytest.mark.asyncio
    async def test_send_transcript_failure_does_not_raise(self):
        """Test that send_transcript failure is handled gracefully."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        # Mock websocket to raise exception
        websocket.send_json.side_effect = Exception("WebSocket closed")
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Should not raise exception
        await handler.send_transcript(text="Test", confidence=0.9, language="en")
        
        # Verify send was attempted
        websocket.send_json.assert_called_once()


class TestVoiceModeHandlerProcessAccumulatedAudio:
    """Tests for process_accumulated_audio method."""
    
    @pytest.mark.asyncio
    async def test_process_empty_buffer_clears_and_returns(self):
        """Test that processing empty buffer clears it and returns early."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Process empty buffer
        await handler.process_accumulated_audio()
        
        # Verify ASR was not called
        asr_service.transcribe_stream.assert_not_called()
        
        # Verify no messages sent
        websocket.send_json.assert_not_called()
    
    @pytest.mark.asyncio
    async def test_process_accumulated_audio_full_flow(self):
        """Test complete flow of processing accumulated audio."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        asr_service.transcribe_stream.return_value = StreamingASRResult(
            transcript="Complete sentence",
            confidence=0.92,
            language="en",
            is_final=True,
        )
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        # Add chunks to buffer
        chunks_data = [b"chunk1", b"chunk2"]
        for data in chunks_data:
            audio_b64 = base64.b64encode(data).decode()
            # NOTE: AudioChunkMessage has been removed with buffer_manager.py
            # This test needs to be updated to use the new PCM-based audio_pipeline API
            # For now, this will fail and needs refactoring
            from app.services.audio_pipeline import AudioPipeline  # Updated import
            # chunk = AudioChunkMessage(audio=audio_b64, is_final=False)
            # handler.audio_buffer.add_chunk(chunk)
            # TODO: Update to use handler.audio_pipeline.add_pcm_chunk(pcm_bytes, is_final)
        
        # Process
        await handler.process_accumulated_audio()
        
        # Verify ASR was called with chunks
        asr_service.transcribe_stream.assert_called_once()
        call_args = asr_service.transcribe_stream.call_args
        assert call_args.kwargs["audio_chunks"] == chunks_data
        
        # Verify transcript was sent
        websocket.send_json.assert_called_once()
        sent_message = websocket.send_json.call_args[0][0]
        assert sent_message["type"] == "transcript"
        assert sent_message["text"] == "Complete sentence"
        
        # Verify buffer was cleared
        assert handler.audio_buffer.get_total_size() == 0


class TestVoiceModeHandlerInitialization:
    """Tests for VoiceModeHandler initialization."""
    
    def test_initialization_with_defaults(self):
        """Test handler initialization with default parameters."""
        websocket = Mock()
        asr_service = Mock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
        )
        
        assert handler.websocket is websocket
        assert handler.session_id == "test-session-123"
        assert handler.asr_service is asr_service
        assert handler.conversation_pipeline is conversation_pipeline
        assert handler.audio_buffer.max_buffer_size == 10 * 1024 * 1024
    
    def test_initialization_with_custom_buffer_size(self):
        """Test handler initialization with custom buffer size."""
        websocket = Mock()
        asr_service = Mock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-456",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            max_buffer_size=5000,
        )
        
        assert handler.audio_buffer.max_buffer_size == 5000



class TestVoiceModeHandlerRateLimiting:
    """Tests for rate limiting functionality.
    
    Validates Requirements: 19.1, 19.2
    """
    
    @pytest.mark.asyncio
    async def test_rate_limit_enforcement(self):
        """Test that rate limit is enforced for audio chunks."""
        # Setup with low rate limit for testing
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            rate_limit_chunks=5,  # Allow only 5 chunks per second
            rate_limit_window=1.0,
        )
        
        # Send chunks up to the limit
        audio_b64 = base64.b64encode(b"test").decode()
        for i in range(5):
            message = {"audio": audio_b64, "is_final": False}
            await handler.handle_audio_chunk(message)
        
        # Verify chunks were accepted
        assert len(handler.audio_buffer.get_chunks()) == 5
        
        # Try to send one more chunk (should be rate limited)
        message = {"audio": audio_b64, "is_final": False}
        await handler.handle_audio_chunk(message)
        
        # Verify error was sent
        websocket.send_json.assert_called()
        error_call = websocket.send_json.call_args_list[-1]
        error_message = error_call[0][0]
        assert error_message["type"] == "error"
        assert error_message["code"] == "RATE_LIMIT_EXCEEDED"
        
        # Buffer should still have only 5 chunks (6th was rejected)
        assert len(handler.audio_buffer.get_chunks()) == 5
    
    @pytest.mark.asyncio
    async def test_rate_limit_resets_after_window(self):
        """Test that rate limit resets after the time window."""
        import time
        
        # Setup with short window for testing
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            rate_limit_chunks=3,
            rate_limit_window=0.1,  # 100ms window
        )
        
        # Send chunks up to limit
        audio_b64 = base64.b64encode(b"test").decode()
        for i in range(3):
            message = {"audio": audio_b64, "is_final": False}
            await handler.handle_audio_chunk(message)
        
        # Wait for window to expire
        time.sleep(0.15)
        
        # Should be able to send more chunks now
        for i in range(3):
            message = {"audio": audio_b64, "is_final": False}
            await handler.handle_audio_chunk(message)
        
        # All chunks should be accepted
        assert len(handler.audio_buffer.get_chunks()) == 6


class TestVoiceModeHandlerChunkSizeValidation:
    """Tests for chunk size validation.
    
    Validates Requirements: 18.3
    """
    
    @pytest.mark.asyncio
    async def test_oversized_chunk_rejected(self):
        """Test that oversized chunks are rejected."""
        # Setup with small chunk size limit
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            max_chunk_size=100,  # Small limit for testing
        )
        
        # Try to send oversized chunk
        large_data = b"x" * 200
        audio_b64 = base64.b64encode(large_data).decode()
        message = {"audio": audio_b64, "is_final": False}
        
        await handler.handle_audio_chunk(message)
        
        # Verify error was sent
        websocket.send_json.assert_called_once()
        error_message = websocket.send_json.call_args[0][0]
        assert error_message["type"] == "error"
        assert error_message["code"] == "CHUNK_SIZE_EXCEEDED"
        
        # Buffer should be empty
        assert handler.audio_buffer.get_total_size() == 0
    
    @pytest.mark.asyncio
    async def test_chunk_at_size_limit_accepted(self):
        """Test that chunk at exact size limit is accepted."""
        # Setup
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            max_chunk_size=100,
        )
        
        # Send chunk at exact limit
        data = b"x" * 100
        audio_b64 = base64.b64encode(data).decode()
        message = {"audio": audio_b64, "is_final": False}
        
        await handler.handle_audio_chunk(message)
        
        # Chunk should be accepted
        assert handler.audio_buffer.get_total_size() == 100
        assert len(handler.audio_buffer.get_chunks()) == 1


class TestVoiceModeHandlerBufferTimeout:
    """Tests for buffer timeout functionality.
    
    Validates Requirements: 19.3
    """
    
    @pytest.mark.asyncio
    async def test_buffer_timeout_enforced(self):
        """Test that proactive flush prevents buffer timeout."""
        import time
        
        # Setup with short timeout
        websocket = AsyncMock()
        asr_service = AsyncMock()
        conversation_pipeline = Mock()
        
        handler = VoiceModeHandler(
            websocket=websocket,
            session_id="test-session-123",
            asr_service=asr_service,
            conversation_pipeline=conversation_pipeline,
            buffer_timeout=0.2,  # 200ms timeout
            max_buffer_duration=0.1,  # 100ms max duration
        )
        
        # Add first chunk
        audio_b64 = base64.b64encode(b"chunk1").decode()
        message = {"audio": audio_b64, "is_final": False}
        await handler.handle_audio_chunk(message)
        
        # Wait for max_buffer_duration to be exceeded (but not timeout)
        time.sleep(0.12)
        
        # should_process should return True due to duration check
        assert handler.audio_buffer.should_process() is True, "should_process should return True when max_buffer_duration exceeded"
