"""
Test for ConversationPipeline.process_message() method.

This test verifies the new process_message() orchestrator that:
- Emits pipeline.state transitions (thinking, speaking, idle)
- Streams LLM tokens via chat.delta messages
- Generates TTS audio and visemes
- Handles cancellation properly
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.ws_messages import (
    ChatDelta,
    ChatFinal,
    MouthCue,
    PipelineState,
    TTSReady,
    VisemesReady,
)
from app.domain.chat.entities import LLMChunk
from app.application.voice.handle_voice_turn import ConversationPipeline
from app.domain.voice.entities import TTSResult


class TestProcessMessage:
    """Test ConversationPipeline.process_message() method."""

    @pytest.mark.asyncio
    async def test_process_message_complete_flow(self):
        """Test complete message processing flow."""
        # Arrange
        session_id = "test-session-123"
        message_id = "test-message-456"
        user_text = "Hello, how are you?"

        # Mock LLM to return streaming tokens
        mock_llm = MagicMock()

        async def mock_stream(*args, **kwargs):
            yield LLMChunk(token="I'm ")
            yield LLMChunk(token="doing ")
            yield LLMChunk(token="great!", is_done=False)
            yield LLMChunk(token="", is_done=True)

        mock_llm.stream = mock_stream

        # Mock TTS to return audio result
        mock_tts = AsyncMock()
        mock_tts.generate.return_value = TTSResult(
            audio_bytes=b"fake_audio_data",
            visemes=[],
            word_boundaries=[],
            audio_duration_ms=1000.0,
            file_path="backend/.data/sessions/test-session-123/test-message-456.mp3",
        )

        # Mock viseme generator
        mock_viseme_gen = AsyncMock()
        mock_viseme_gen.generate_from_audio.return_value = [
            MouthCue(start=0.0, end=0.5, value="viseme_aa"),
            MouthCue(start=0.5, end=1.0, value="viseme_PP"),
        ]

        # Create pipeline with mocks
        pipeline = ConversationPipeline(avatar_id="avatar1", llm=mock_llm, tts=mock_tts)

        # Track sent messages
        sent_messages = []

        async def send_callback(message):
            sent_messages.append(message)

        # Act
        with patch(
            "app.infrastructure.tts.viseme_generator.VisemeGenerator", return_value=mock_viseme_gen
        ):
            await pipeline.process_message(
                message_id=message_id,
                text=user_text,
                session_id=session_id,
                send_callback=send_callback,
            )

        # Assert
        # Check message sequence
        assert len(sent_messages) >= 6, f"Expected at least 6 messages, got {len(sent_messages)}"

        # 1. thinking state
        assert isinstance(sent_messages[0], PipelineState)
        assert sent_messages[0].state == "thinking"

        # 2-4. chat.delta messages (3 tokens)
        delta_messages = [m for m in sent_messages if isinstance(m, ChatDelta)]
        assert len(delta_messages) == 3
        assert delta_messages[0].delta == "I'm "
        assert delta_messages[1].delta == "doing "
        assert delta_messages[2].delta == "great!"

        # 5. chat.final
        final_messages = [m for m in sent_messages if isinstance(m, ChatFinal)]
        assert len(final_messages) == 1
        assert final_messages[0].text == "I'm doing great!"

        # 6. speaking state
        speaking_states = [
            m for m in sent_messages if isinstance(m, PipelineState) and m.state == "speaking"
        ]
        assert len(speaking_states) == 1

        # 7. tts.ready
        tts_ready_messages = [m for m in sent_messages if isinstance(m, TTSReady)]
        assert len(tts_ready_messages) == 1
        assert tts_ready_messages[0].audio.url == f"/api/v1/audio/{session_id}/{message_id}.mp3"
        assert tts_ready_messages[0].audio.duration_ms == 1000

        # 8. visemes.ready
        visemes_ready_messages = [m for m in sent_messages if isinstance(m, VisemesReady)]
        assert len(visemes_ready_messages) == 1
        assert len(visemes_ready_messages[0].mouthCues) == 2

        # 9. idle state (final)
        idle_states = [
            m for m in sent_messages if isinstance(m, PipelineState) and m.state == "idle"
        ]
        assert len(idle_states) == 1

        # Verify TTS was called with correct parameters
        mock_tts.generate.assert_called_once_with(
            text="I'm doing great!", session_id=session_id, message_id=message_id
        )

        # Verify viseme generator was called
        mock_viseme_gen.generate_from_audio.assert_called_once()

    @pytest.mark.asyncio
    async def test_process_message_handles_abort(self):
        """Test that process_message respects abort flag."""
        # Arrange
        session_id = "test-session-123"
        message_id = "test-message-456"
        user_text = "Hello"

        # Mock LLM to yield tokens slowly
        mock_llm = MagicMock()

        async def mock_stream(*args, **kwargs):
            yield LLMChunk(token="Hello ")
            await asyncio.sleep(0.1)
            yield LLMChunk(token="world")
            yield LLMChunk(token="", is_done=True)

        mock_llm.stream = mock_stream

        pipeline = ConversationPipeline(avatar_id="avatar1", llm=mock_llm)

        sent_messages = []

        async def send_callback(message):
            sent_messages.append(message)

        # Act - abort during processing
        async def abort_after_delay():
            await asyncio.sleep(0.05)
            pipeline.abort()

        await asyncio.gather(
            pipeline.process_message(
                message_id=message_id,
                text=user_text,
                session_id=session_id,
                send_callback=send_callback,
            ),
            abort_after_delay(),
        )

        # Assert - should have thinking state and idle state, but incomplete processing
        assert len(sent_messages) >= 2
        assert isinstance(sent_messages[0], PipelineState)
        assert sent_messages[0].state == "thinking"

        # Last message should be idle
        assert isinstance(sent_messages[-1], PipelineState)
        assert sent_messages[-1].state == "idle"

        # Should not have tts.ready or visemes.ready
        tts_ready = [m for m in sent_messages if isinstance(m, TTSReady)]
        assert len(tts_ready) == 0

    @pytest.mark.asyncio
    async def test_process_message_handles_empty_text(self):
        """Test that process_message handles empty text input."""
        # Arrange
        session_id = "test-session-123"
        message_id = "test-message-456"
        user_text = "   "  # Empty/whitespace

        pipeline = ConversationPipeline(avatar_id="avatar1")

        sent_messages = []

        async def send_callback(message):
            sent_messages.append(message)

        # Act
        await pipeline.process_message(
            message_id=message_id,
            text=user_text,
            session_id=session_id,
            send_callback=send_callback,
        )

        # Assert - should send error message
        from app.schemas.ws_messages import ErrorMessage

        error_messages = [m for m in sent_messages if isinstance(m, ErrorMessage)]
        assert len(error_messages) == 1
        assert error_messages[0].code == "EMPTY_INPUT"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
