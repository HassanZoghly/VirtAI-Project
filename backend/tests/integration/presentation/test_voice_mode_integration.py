"""
Test WebSocket handler integration with VoiceModeHandler.

This test verifies that the WebSocket handler properly routes audio_chunk
messages to VoiceModeHandler and handles voice_mode_stop messages.

Requirements: 11.1, 11.2, 11.3, 12.4
"""

import asyncio
import base64
import sys
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_websocket_routes_voice_mode_audio_chunks():
    """
    Test that WebSocket handler routes voice mode audio chunks to VoiceModeHandler.

    Validates Requirements 11.1, 11.2, 3.1, 3.2
    """
    # Arrange
    from app.presentation.ws.gateway import WebSocketHandler
    from app.application.chat.session_manager import Session

    session_id = str(uuid.uuid4())

    # Mock WebSocket
    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()

    # Mock Session and Pipeline
    mock_pipeline = MagicMock()
    mock_pipeline.abort = MagicMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_session.pipeline = mock_pipeline
    mock_session.touch = MagicMock()

    # Create handler
    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    # Mock the VoiceModeHandler with audio_pipeline (current API)
    mock_voice_handler = MagicMock()
    mock_voice_handler.handle_audio_chunk = AsyncMock()
    mock_voice_handler.process_accumulated_audio = AsyncMock()
    mock_voice_handler.audio_pipeline = MagicMock()
    mock_voice_handler.audio_pipeline.get_buffer_size.return_value = 100  # Simulate buffered audio
    handler._voice_mode_handler = mock_voice_handler

    # Create voice mode audio chunk message (has is_final flag)
    # When is_final=True and buffer has data, _handle_audio_chunk triggers process_accumulated_audio
    message = {"type": "audio_chunk", "data": {"is_final": True, "timestamp": 1234567890.0}}

    # Act
    import json
    from app.schemas.audio import AudioBuffer

    audio_buffer = AudioBuffer()
    await handler._route_message(json.dumps(message), audio_buffer)

    # Assert
    # Voice mode handler should have processed accumulated audio
    mock_voice_handler.process_accumulated_audio.assert_called_once()

    # Legacy audio buffer should NOT have been used
    assert audio_buffer.is_empty


@pytest.mark.asyncio
async def test_websocket_handles_voice_mode_stop():
    """
    Test that WebSocket handler handles voice_mode_stop message.

    Validates Requirements 11.2, 11.3
    """
    # Arrange
    from app.presentation.ws.gateway import WebSocketHandler
    from app.application.chat.session_manager import Session

    session_id = str(uuid.uuid4())

    # Mock WebSocket
    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()

    # Mock Session and Pipeline
    mock_pipeline = MagicMock()
    mock_pipeline.abort = MagicMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_session.pipeline = mock_pipeline
    mock_session.touch = MagicMock()

    # Create handler
    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    # Mock the VoiceModeHandler with audio_pipeline (current API)
    mock_voice_handler = MagicMock()
    mock_audio_pipeline = MagicMock()
    mock_voice_handler.audio_pipeline = mock_audio_pipeline
    handler._voice_mode_handler = mock_voice_handler

    # Create voice_mode_stop message
    message = {"type": "voice_mode_stop", "data": {}}

    # Act
    import json
    from app.schemas.audio import AudioBuffer

    audio_buffer = AudioBuffer()
    await handler._route_message(json.dumps(message), audio_buffer)

    # Assert
    # Audio pipeline buffer should have been cleared
    mock_audio_pipeline.clear_buffer.assert_called_once()


@pytest.mark.asyncio
async def test_websocket_cleanup_clears_voice_mode_buffer():
    """
    Test that WebSocket cleanup clears voice mode buffer on disconnection.

    Validates Requirements 11.1, 11.2, 12.4
    """
    # Arrange
    from app.presentation.ws.gateway import WebSocketHandler
    from app.application.chat.session_manager import Session

    session_id = str(uuid.uuid4())

    # Mock WebSocket
    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()

    # Mock Session and Pipeline
    mock_pipeline = MagicMock()
    mock_pipeline.abort = MagicMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_session.pipeline = mock_pipeline
    mock_session.touch = MagicMock()

    # Create handler
    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    # Mock the VoiceModeHandler with audio_pipeline (current API)
    mock_voice_handler = MagicMock()
    mock_audio_pipeline = MagicMock()
    mock_audio_pipeline.get_buffer_size.return_value = 0
    mock_voice_handler.audio_pipeline = mock_audio_pipeline
    handler._voice_mode_handler = mock_voice_handler

    # Act
    await handler._cleanup()

    # Assert
    # Audio pipeline buffer should have been cleared during cleanup
    mock_audio_pipeline.clear_buffer.assert_called_once()
    assert handler._connected is False


@pytest.mark.asyncio
async def test_websocket_routes_legacy_audio_chunks():
    """
    Test that WebSocket handler still routes legacy audio chunks (without is_final).

    This ensures backward compatibility with the old protocol.
    """
    # Arrange
    from app.presentation.ws.gateway import WebSocketHandler
    from app.application.chat.session_manager import Session

    session_id = str(uuid.uuid4())

    # Mock WebSocket
    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()

    # Mock Session and Pipeline
    mock_pipeline = MagicMock()
    mock_pipeline.abort = MagicMock()

    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_session.pipeline = mock_pipeline
    mock_session.touch = MagicMock()

    # Create handler
    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    # Create legacy audio chunk message (no is_final flag)
    audio_data = b"fake audio data"
    audio_b64 = base64.b64encode(audio_data).decode("utf-8")

    message = {"type": "audio_chunk", "data": {"chunk": audio_b64}}

    # Act
    import json
    from app.schemas.audio import AudioBuffer

    audio_buffer = AudioBuffer()
    await handler._route_message(json.dumps(message), audio_buffer)

    # Assert
    # Legacy audio buffer should have been used
    assert not audio_buffer.is_empty
    assert audio_buffer.chunk_count == 1
