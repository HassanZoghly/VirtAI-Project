"""
Test WebSocket handler integration with process_message.

This test verifies that the WebSocket handler properly calls
ConversationPipeline.process_message() when receiving chat.user_message.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.schemas.ws_messages import ChatUserMessage


@pytest.mark.asyncio
async def test_websocket_handler_calls_process_message():
    """
    Test that WebSocket handler calls process_message when receiving chat.user_message.
    """
    # Arrange
    import uuid

    from app.presentation.ws.gateway import WebSocketHandler
    from app.application.chat.session_manager import Session

    # Generate valid UUIDs
    session_id = str(uuid.uuid4())
    message_id = str(uuid.uuid4())

    # Mock WebSocket
    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()
    mock_ws.send_text = AsyncMock()

    # Mock Session with pipeline
    mock_session = MagicMock(spec=Session)
    mock_session.session_id = session_id
    mock_session.avatar_id = "avatar1"
    mock_pipeline = MagicMock()
    mock_pipeline.process_message = AsyncMock()
    mock_session.pipeline = mock_pipeline

    # Create handler
    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    # Create test message
    test_message = ChatUserMessage(
        session_id=session_id, message_id=message_id, text="Hello, how are you?"
    )

    # Act
    await handler._handle_chat_user_message(test_message)

    # Wait for the task to start
    import asyncio

    await asyncio.sleep(0.1)

    # Assert
    # Verify process_message was called with correct arguments
    mock_pipeline.process_message.assert_called_once()
    call_args = mock_pipeline.process_message.call_args

    assert call_args.kwargs["message_id"] == message_id
    assert call_args.kwargs["text"] == "Hello, how are you?"
    assert call_args.kwargs["session_id"] == session_id
    assert callable(call_args.kwargs["send_callback"])

    # Cleanup
    if handler._pipeline_task:
        handler._pipeline_task.cancel()
        try:
            await handler._pipeline_task
        except asyncio.CancelledError:
            pass


@pytest.mark.asyncio
async def test_send_protocol_message_formats_correctly():
    """
    Test that _send_protocol_message correctly formats Pydantic models.
    """
    # Arrange
    from app.presentation.ws.gateway import WebSocketHandler
    from app.schemas.ws_messages import ChatDelta, PipelineState
    from app.application.chat.session_manager import Session

    # Mock WebSocket
    mock_ws = MagicMock()
    mock_ws.send_json = AsyncMock()

    # Mock Session with pipeline
    mock_session = MagicMock(spec=Session)
    mock_session.session_id = "test-session-123"
    mock_session.avatar_id = "avatar1"
    mock_pipeline = MagicMock()
    mock_session.pipeline = mock_pipeline

    # Create handler
    handler = WebSocketHandler(websocket=mock_ws, session=mock_session)
    handler._connected = True

    # Test ChatDelta
    delta_msg = ChatDelta(
        session_id="test-session-123", message_id="test-message-456", delta="Hello"
    )

    await handler._send_protocol_message(delta_msg)

    # Verify the envelope format
    mock_ws.send_json.assert_called_once()
    call_args = mock_ws.send_json.call_args[0][0]

    assert call_args["type"] == "chat.delta"
    assert call_args["data"]["session_id"] == "test-session-123"
    assert call_args["data"]["message_id"] == "test-message-456"
    assert call_args["data"]["delta"] == "Hello"

    # Reset mock
    mock_ws.send_json.reset_mock()

    # Test PipelineState
    state_msg = PipelineState(session_id="test-session-123", state="thinking")

    await handler._send_protocol_message(state_msg)

    # Verify the envelope format
    mock_ws.send_json.assert_called_once()
    call_args = mock_ws.send_json.call_args[0][0]

    assert call_args["type"] == "pipeline.state"
    assert call_args["data"]["session_id"] == "test-session-123"
    assert call_args["data"]["state"] == "thinking"
