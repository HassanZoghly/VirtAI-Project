from app.schemas.ws_messages import make_user_message_echo


def test_make_user_message_echo_payload() -> None:
    message = make_user_message_echo(
        session_id="session-123",
        message_id="message-456",
        text="hello",
        conversation_id="conv-789",
    )

    dumped = message.model_dump()
    assert dumped["session_id"] == "session-123"
    assert dumped["message_id"] == "message-456"
    assert dumped["text"] == "hello"
    assert dumped["conversation_id"] == "conv-789"
