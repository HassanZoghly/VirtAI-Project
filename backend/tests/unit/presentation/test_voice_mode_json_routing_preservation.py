"""
Preservation Property Tests for Voice Mode JSON Routing Fix

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

This test suite verifies that all inputs that do NOT involve JSON text frames with
`is_final` flag are completely unaffected by the fix. This includes:
- Binary WebSocket frames (voice mode PCM audio)
- Legacy JSON audio chunks without `is_final` flag
- Audio buffer overflow protection
- Other message types (text_input, audio_end, ping, abort)

IMPORTANT: These tests should PASS on UNFIXED code to establish baseline behavior.
They confirm what behavior must be preserved when implementing the fix.

Property 2: Preservation - Binary Frame and Legacy Chunk Handling

For any input that is NOT a JSON text frame with `is_final` flag (binary WebSocket
frames, legacy JSON chunks without `is_final`, other message types), the fixed code
SHALL produce exactly the same behavior as the original code.
"""

import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from hypothesis import given, strategies as st, settings, HealthCheck

from app.presentation.ws.gateway import WebSocketHandler
from app.application.chat.session_manager import Session
from app.schemas.audio import AudioBuffer


# Constants from websocket.py
MAX_AUDIO_BUFFER_SIZE = 10 * 1024 * 1024  # 10MB


@pytest.mark.asyncio
async def test_binary_frame_routes_to_voice_handler():
    """
    Test that binary WebSocket frames route to _handle_binary_frame() and voice handler.

    **Validates: Requirement 3.1**

    EXPECTED OUTCOME: Test PASSES on unfixed code (confirms baseline behavior)

    This test verifies that binary frames containing PCM audio bytes are correctly
    routed to the voice handler via _handle_binary_frame(), not through _handle_audio_chunk().
    """
    # Arrange
    import uuid

    session_id = str(uuid.uuid4())

    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()
    mock_ws.send_text = AsyncMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_pipeline = MagicMock()
    mock_session.pipeline = mock_pipeline

    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    # Create mock voice handler
    mock_voice_handler = MagicMock()
    mock_voice_handler.handle_audio_chunk = AsyncMock()

    with patch.object(handler, "_get_voice_mode_handler", return_value=mock_voice_handler):
        # Generate PCM audio bytes (16-bit signed integer, 640 bytes = 20ms at 16kHz)
        pcm_bytes = b"\x00\x01" * 320  # 640 bytes of PCM audio

        # Act
        await handler._handle_binary_frame(pcm_bytes)

        # Assert
        # Voice handler should be called with bytes and is_final=False
        mock_voice_handler.handle_audio_chunk.assert_called_once_with(pcm_bytes, is_final=False)

        # No error should be sent to WebSocket
        assert not mock_ws.send_json.called or not any(
            call[0][0].get("type") == "error" for call in mock_ws.send_json.call_args_list
        )


@pytest.mark.asyncio
@given(
    # Generate random PCM audio chunks of various sizes
    chunk_size=st.integers(min_value=160, max_value=3200),  # 5ms to 100ms at 16kHz
)
@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
async def test_binary_frames_property(chunk_size: int):
    """
    Property-based test: Binary frames always route to voice handler.

    **Validates: Requirement 3.1**

    For any binary frame with valid PCM audio bytes, the system SHALL route it to
    _handle_binary_frame() and then to voice_handler.handle_audio_chunk().
    """
    # Arrange
    import uuid

    session_id = str(uuid.uuid4())

    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_pipeline = MagicMock()
    mock_session.pipeline = mock_pipeline

    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    mock_voice_handler = MagicMock()
    mock_voice_handler.handle_audio_chunk = AsyncMock()

    with patch.object(handler, "_get_voice_mode_handler", return_value=mock_voice_handler):
        # Generate PCM audio bytes
        pcm_bytes = b"\x00\x01" * (chunk_size // 2)

        # Act
        await handler._handle_binary_frame(pcm_bytes)

        # Assert
        mock_voice_handler.handle_audio_chunk.assert_called_once()
        call_args = mock_voice_handler.handle_audio_chunk.call_args
        assert call_args[0][0] == pcm_bytes
        assert call_args[1]["is_final"] == False


@pytest.mark.asyncio
async def test_legacy_chunk_without_is_final_buffered():
    """
    Test that legacy JSON chunks without is_final are base64-decoded and buffered.

    **Validates: Requirements 3.2, 3.3**

    EXPECTED OUTCOME: Test PASSES on unfixed code (confirms baseline behavior)

    This test verifies that legacy audio chunks (JSON text frames with base64-encoded
    audio data but NO is_final flag) are correctly decoded and accumulated in the
    audio_buffer for later processing via audio_end.
    """
    # Arrange
    import uuid

    session_id = str(uuid.uuid4())

    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_pipeline = MagicMock()
    mock_session.pipeline = mock_pipeline

    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    audio_buffer = AudioBuffer()

    # Create legacy audio chunk (base64-encoded, NO is_final flag)
    test_audio_data = b"test audio data for legacy protocol"
    chunk_b64 = base64.b64encode(test_audio_data).decode("utf-8")

    test_data = {
        "type": "audio_chunk",
        "data": {"chunk": chunk_b64},
        # Note: NO is_final flag
    }

    # Act
    await handler._handle_audio_chunk(test_data, audio_buffer)

    # Assert
    # Audio should be decoded and buffered
    assert audio_buffer.chunk_count == 1
    assert audio_buffer.total_size == len(test_audio_data)
    assert audio_buffer.get_combined() == test_audio_data

    # No error should be sent
    assert not mock_ws.send_json.called or not any(
        call[0][0].get("type") == "error" for call in mock_ws.send_json.call_args_list
    )


@pytest.mark.asyncio
@given(
    # Generate random base64-encoded audio chunks
    chunk_data=st.binary(min_size=100, max_size=5000),
    num_chunks=st.integers(min_value=1, max_value=10),
)
@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
async def test_legacy_chunk_buffering_property(chunk_data: bytes, num_chunks: int):
    """
    Property-based test: Legacy chunks without is_final are always buffered.

    **Validates: Requirements 3.2, 3.3**

    For any legacy audio chunk (JSON text frame with base64-encoded audio but NO
    is_final flag), the system SHALL decode and buffer it in audio_buffer.
    """
    # Arrange
    import uuid

    session_id = str(uuid.uuid4())

    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_pipeline = MagicMock()
    mock_session.pipeline = mock_pipeline

    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    audio_buffer = AudioBuffer()

    # Act - send multiple chunks
    for i in range(num_chunks):
        chunk_b64 = base64.b64encode(chunk_data).decode("utf-8")
        test_data = {"type": "audio_chunk", "data": {"chunk": chunk_b64}}
        await handler._handle_audio_chunk(test_data, audio_buffer)

    # Assert
    assert audio_buffer.chunk_count == num_chunks
    assert audio_buffer.total_size == len(chunk_data) * num_chunks

    # Verify all chunks are correctly buffered
    combined = audio_buffer.get_combined()
    expected = chunk_data * num_chunks
    assert combined == expected


@pytest.mark.asyncio
async def test_buffer_overflow_protection():
    """
    Test that audio buffer overflow protection works correctly.

    **Validates: Requirement 3.4**

    EXPECTED OUTCOME: Test PASSES on unfixed code (confirms baseline behavior)

    This test verifies that when the audio buffer exceeds MAX_AUDIO_BUFFER_SIZE,
    the system clears the buffer and sends an error message.
    """
    # Arrange
    import uuid

    session_id = str(uuid.uuid4())

    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()
    mock_ws.send_text = AsyncMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_pipeline = MagicMock()
    mock_session.pipeline = mock_pipeline

    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    audio_buffer = AudioBuffer()

    # Create a large chunk that would exceed MAX_AUDIO_BUFFER_SIZE
    large_chunk_data = b"x" * (MAX_AUDIO_BUFFER_SIZE + 1000)
    chunk_b64 = base64.b64encode(large_chunk_data).decode("utf-8")

    test_data = {"type": "audio_chunk", "data": {"chunk": chunk_b64}}

    # Act
    await handler._handle_audio_chunk(test_data, audio_buffer)

    # Assert
    # Buffer should be cleared (overflow protection)
    assert audio_buffer.is_empty
    assert audio_buffer.total_size == 0

    # Error message should be sent via send_text (ServerMessage.to_json())
    assert mock_ws.send_text.called
    error_sent = False
    for call in mock_ws.send_text.call_args_list:
        msg_text = call[0][0] if call[0] else ""
        if "AUDIO_TOO_LARGE" in msg_text:
            error_sent = True
            break

    assert error_sent, "Expected AUDIO_TOO_LARGE error to be sent"


@pytest.mark.asyncio
@given(
    # Generate chunks that approach the buffer limit
    chunk_size=st.integers(min_value=1000, max_value=100000),
)
@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
async def test_buffer_overflow_property(chunk_size: int):
    """
    Property-based test: Buffer overflow protection always triggers at limit.

    **Validates: Requirement 3.4**

    For any audio chunk that would cause the buffer to exceed MAX_AUDIO_BUFFER_SIZE,
    the system SHALL clear the buffer and send an error message.
    """
    # Arrange
    import uuid

    session_id = str(uuid.uuid4())

    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()
    mock_ws.send_text = AsyncMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_pipeline = MagicMock()
    mock_session.pipeline = mock_pipeline

    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    audio_buffer = AudioBuffer()

    # Pre-fill buffer to near capacity
    prefill_size = MAX_AUDIO_BUFFER_SIZE - chunk_size + 1
    if prefill_size > 0:
        prefill_data = b"x" * prefill_size
        audio_buffer.add_chunk(prefill_data)

    # Create chunk that will exceed limit
    chunk_data = b"y" * chunk_size
    chunk_b64 = base64.b64encode(chunk_data).decode("utf-8")

    test_data = {"type": "audio_chunk", "data": {"chunk": chunk_b64}}

    # Act
    await handler._handle_audio_chunk(test_data, audio_buffer)

    # Assert
    # If adding this chunk would exceed limit, buffer should be cleared
    if prefill_size + chunk_size > MAX_AUDIO_BUFFER_SIZE:
        assert audio_buffer.is_empty or audio_buffer.total_size < MAX_AUDIO_BUFFER_SIZE
        # Error should be sent via send_text
        assert mock_ws.send_text.called
    else:
        # Otherwise, chunk should be buffered normally
        assert audio_buffer.chunk_count >= 1


@pytest.mark.asyncio
async def test_other_message_types_unaffected():
    """
    Test that other message types (text_input, ping, abort) are unaffected.

    **Validates: Requirements 3.1, 3.2, 3.3, 3.4 (regression prevention)**

    EXPECTED OUTCOME: Test PASSES on unfixed code (confirms baseline behavior)

    This test verifies that message types other than audio_chunk with is_final
    continue to work correctly and are not affected by the fix.
    """
    # Arrange
    import uuid

    session_id = str(uuid.uuid4())

    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()
    mock_ws.send_text = AsyncMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_pipeline = MagicMock()
    mock_session.pipeline = mock_pipeline

    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    # Test ping message
    await handler._handle_ping()

    # Assert - pong should be sent via send_text
    pong_sent = False
    for call in mock_ws.send_text.call_args_list:
        msg_json = call[0][0] if call[0] else call[1].get("text", "")
        if "pong" in msg_json.lower():
            pong_sent = True
            break

    assert pong_sent, "Expected pong response to ping"

    # Reset mock
    mock_ws.send_text.reset_mock()

    # Test text_input message (data.data.text is the expected nesting)
    test_text_data = {"type": "text_input", "data": {"text": "Hello, world!"}}

    with patch.object(handler, "_run_pipeline_text", new_callable=AsyncMock) as mock_run_pipeline:
        await handler._handle_text_input(test_text_data)

        # Assert - pipeline should be called with text
        mock_run_pipeline.assert_called_once_with("Hello, world!")

    # Test abort message
    mock_ws.send_text.reset_mock()

    with patch.object(handler, "_cancel_pipeline", new_callable=AsyncMock) as mock_cancel:
        await handler._handle_abort()

        # Assert - pipeline should be cancelled
        mock_cancel.assert_called_once()


@pytest.mark.asyncio
async def test_legacy_chunk_with_empty_data_field():
    """
    Test that legacy chunks with empty or missing data field are handled gracefully.

    **Validates: Requirements 3.2, 3.3**

    EXPECTED OUTCOME: Test PASSES on unfixed code (confirms baseline behavior)

    This test verifies that legacy audio chunks with missing or empty chunk data
    are handled gracefully without crashing.
    """
    # Arrange
    import uuid

    session_id = str(uuid.uuid4())

    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_pipeline = MagicMock()
    mock_session.pipeline = mock_pipeline

    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    audio_buffer = AudioBuffer()

    # Test with missing chunk field
    test_data_1 = {"type": "audio_chunk", "data": {}}  # No chunk field

    # Act
    await handler._handle_audio_chunk(test_data_1, audio_buffer)

    # Assert - should handle gracefully, buffer remains empty
    assert audio_buffer.is_empty

    # Test with missing data field entirely
    test_data_2 = {
        "type": "audio_chunk"
        # No data field
    }

    # Act
    await handler._handle_audio_chunk(test_data_2, audio_buffer)

    # Assert - should handle gracefully, buffer remains empty
    assert audio_buffer.is_empty


@pytest.mark.asyncio
async def test_legacy_chunk_with_invalid_base64():
    """
    Test that legacy chunks with invalid base64 encoding are handled gracefully.

    **Validates: Requirements 3.2, 3.3**

    EXPECTED OUTCOME: Test PASSES on unfixed code (confirms baseline behavior)

    This test verifies that legacy audio chunks with invalid base64 encoding
    send an error message and don't crash the handler.
    """
    # Arrange
    import uuid

    session_id = str(uuid.uuid4())

    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()
    mock_ws.send_text = AsyncMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_pipeline = MagicMock()
    mock_session.pipeline = mock_pipeline

    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    audio_buffer = AudioBuffer()

    # Create chunk with invalid base64
    test_data = {"type": "audio_chunk", "data": {"chunk": "!!!invalid base64!!!"}}

    # Act
    await handler._handle_audio_chunk(test_data, audio_buffer)

    # Assert
    # Buffer should remain empty
    assert audio_buffer.is_empty

    # Error message should be sent via send_text (ServerMessage.to_json())
    assert mock_ws.send_text.called
    error_sent = False
    for call in mock_ws.send_text.call_args_list:
        msg_text = call[0][0] if call[0] else ""
        if "INVALID_AUDIO" in msg_text:
            error_sent = True
            break

    assert error_sent, "Expected INVALID_AUDIO error to be sent"
