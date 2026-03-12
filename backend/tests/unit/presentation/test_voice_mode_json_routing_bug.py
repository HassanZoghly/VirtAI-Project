"""
Bug Condition Exploration Test for Voice Mode JSON Routing Fix

**Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2**

This test explores the bug condition where JSON text frames containing `is_final` flags
are incorrectly routed to the voice handler's `handle_audio_chunk` method, which expects
bytes but receives dict objects, causing ValueError "Audio data must be bytes".

CRITICAL: This test is EXPECTED TO FAIL on unfixed code - failure confirms the bug exists.
DO NOT attempt to fix the test or the code when it fails.

The test encodes the expected behavior - it will validate the fix when it passes after implementation.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from hypothesis import given, strategies as st

from app.presentation.ws.gateway import WebSocketHandler
from app.application.chat.session_manager import Session
from app.schemas.audio import AudioBuffer


@pytest.mark.asyncio
@given(
    # Generate JSON text frames with is_final flag at various positions
    is_final_value=st.booleans(),
    has_chunk_data=st.booleans(),
)
async def test_json_text_frames_with_is_final_not_routed_to_voice_handler(
    is_final_value: bool, has_chunk_data: bool
):
    """
    Property 1: Fault Condition - JSON Text Frames Not Routed to Voice Handler
    
    **Validates: Requirements 2.1, 2.2**
    
    For any JSON text frame where the message type is "audio_chunk" and the `is_final` flag
    is present (either at top level or nested in data field), the fixed `_handle_audio_chunk`
    function SHALL NOT route the dict object to `voice_handler.handle_audio_chunk()`, and
    SHALL instead handle it as a legacy protocol message.
    
    EXPECTED OUTCOME ON UNFIXED CODE: Test FAILS with ValueError "Audio data must be bytes"
    (this is correct - it proves the bug exists)
    
    EXPECTED OUTCOME ON FIXED CODE: Test PASSES (no ValueError, dict not routed to voice handler)
    """
    # Arrange
    import uuid

    session_id = str(uuid.uuid4())

    # Mock WebSocket
    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()
    mock_ws.send_text = AsyncMock()

    # Mock Session with pipeline
    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_pipeline = MagicMock()
    mock_session.pipeline = mock_pipeline

    # Create handler
    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    # Create audio buffer
    audio_buffer = AudioBuffer()

    # Generate test data with is_final flag
    if has_chunk_data:
        # JSON text frame with both is_final and chunk data
        test_data = {
            "type": "audio_chunk",
            "is_final": is_final_value,
            "data": {"chunk": "dGVzdCBhdWRpbyBkYXRh"},  # base64 encoded "test audio data"
        }
    else:
        # JSON text frame with only is_final flag (no chunk data)
        test_data = {"type": "audio_chunk", "is_final": is_final_value}

    # Act
    await handler._handle_audio_chunk(test_data, audio_buffer)
    
    # Assert
    # On UNFIXED code: The voice handler catches ValueError and sends error message
    # Check if error message was sent to WebSocket
    # On FIXED code: No error message should be sent (dict not routed to voice handler)
    
    # Check if send_json was called with error message
    if mock_ws.send_json.called:
        # Get the last call arguments
        call_args = mock_ws.send_json.call_args
        if call_args:
            error_msg = call_args[0][0] if call_args[0] else call_args[1].get("json", {})
            if isinstance(error_msg, dict) and error_msg.get("type") == "error":
                if "INVALID_AUDIO_DATA" in error_msg.get("code", ""):
                    # This is the bug condition - dict was routed to voice handler
                    pytest.fail(
                        f"BUG DETECTED: JSON text frame with is_final={is_final_value} "
                        f"was incorrectly routed to voice handler, causing error. "
                        f"Counterexample: {test_data} | Error: {error_msg}"
                    )


@pytest.mark.asyncio
async def test_json_text_frame_with_top_level_is_final():
    """
    Test Case 1: JSON text frame with top-level is_final flag
    
    **Validates: Requirements 1.1, 2.1**
    
    EXPECTED ON UNFIXED CODE: ValueError "Audio data must be bytes"
    EXPECTED ON FIXED CODE: No error, handled as legacy protocol message
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

    # JSON text frame with top-level is_final
    test_data = {"type": "audio_chunk", "is_final": True}

    # Act
    await handler._handle_audio_chunk(test_data, audio_buffer)
    
    # Assert
    # Check if error message was sent to WebSocket
    if mock_ws.send_json.called:
        call_args = mock_ws.send_json.call_args
        if call_args:
            error_msg = call_args[0][0] if call_args[0] else call_args[1].get("json", {})
            if isinstance(error_msg, dict) and error_msg.get("type") == "error":
                if "INVALID_AUDIO_DATA" in error_msg.get("code", ""):
                    pytest.fail(
                        f"BUG DETECTED: JSON text frame {test_data} was incorrectly routed to voice handler"
                    )


@pytest.mark.asyncio
async def test_json_text_frame_with_nested_is_final():
    """
    Test Case 2: JSON text frame with nested is_final flag in data field
    
    **Validates: Requirements 1.3, 2.2**
    
    EXPECTED ON UNFIXED CODE: ValueError "Audio data must be bytes"
    EXPECTED ON FIXED CODE: No error, handled as legacy protocol message
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

    # JSON text frame with nested is_final in data field
    test_data = {"type": "audio_chunk", "data": {"is_final": True}}

    # Act
    await handler._handle_audio_chunk(test_data, audio_buffer)
    
    # Assert
    # Check if error message was sent to WebSocket
    if mock_ws.send_json.called:
        call_args = mock_ws.send_json.call_args
        if call_args:
            error_msg = call_args[0][0] if call_args[0] else call_args[1].get("json", {})
            if isinstance(error_msg, dict) and error_msg.get("type") == "error":
                if "INVALID_AUDIO_DATA" in error_msg.get("code", ""):
                    pytest.fail(
                        f"BUG DETECTED: JSON text frame {test_data} was incorrectly routed to voice handler"
                    )


@pytest.mark.asyncio
async def test_json_text_frame_with_is_final_and_chunk_data():
    """
    Test Case 3: JSON text frame with is_final flag and base64 chunk data
    
    **Validates: Requirements 1.1, 2.1**
    
    EXPECTED ON UNFIXED CODE: ValueError "Audio data must be bytes"
    EXPECTED ON FIXED CODE: No error, chunk data buffered as legacy protocol
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

    # JSON text frame with is_final and chunk data
    test_data = {
        "type": "audio_chunk",
        "is_final": True,
        "data": {"chunk": "dGVzdCBhdWRpbyBkYXRh"},  # base64 encoded "test audio data"
    }

    # Act
    await handler._handle_audio_chunk(test_data, audio_buffer)
    
    # Assert
    # Check if error message was sent to WebSocket
    if mock_ws.send_json.called:
        call_args = mock_ws.send_json.call_args
        if call_args:
            error_msg = call_args[0][0] if call_args[0] else call_args[1].get("json", {})
            if isinstance(error_msg, dict) and error_msg.get("type") == "error":
                if "INVALID_AUDIO_DATA" in error_msg.get("code", ""):
                    pytest.fail(
                        f"BUG DETECTED: JSON text frame {test_data} was incorrectly routed to voice handler"
                    )
