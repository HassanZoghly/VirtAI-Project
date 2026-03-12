"""Tests for chat domain entities — pure dataclass behavior."""

import pytest

from app.domain.chat.entities import (
    ChatMessage,
    ConversationHistory,
    LLMChunk,
    LLMResult,
    MessageRole,
    PipelineEvent,
    PipelineEventType,
    ev,
)


class TestMessageRole:
    def test_values(self):
        assert MessageRole.SYSTEM == "system"
        assert MessageRole.USER == "user"
        assert MessageRole.ASSISTANT == "assistant"

    def test_is_str_enum(self):
        assert isinstance(MessageRole.SYSTEM, str)


class TestChatMessage:
    def test_creation(self):
        msg = ChatMessage(role=MessageRole.USER, content="hello")
        assert msg.role == MessageRole.USER
        assert msg.content == "hello"

    def test_to_dict(self):
        msg = ChatMessage(role=MessageRole.ASSISTANT, content="hi")
        d = msg.to_dict()
        assert d == {"role": "assistant", "content": "hi"}

    def test_to_dict_system(self):
        msg = ChatMessage(role=MessageRole.SYSTEM, content="You are helpful")
        assert msg.to_dict() == {"role": "system", "content": "You are helpful"}


class TestLLMChunk:
    def test_defaults(self):
        chunk = LLMChunk(token="hello")
        assert chunk.token == "hello"
        assert chunk.is_done is False
        assert chunk.sentence is None

    def test_done_chunk(self):
        chunk = LLMChunk(token="", is_done=True, sentence="Full sentence.")
        assert chunk.is_done is True
        assert chunk.sentence == "Full sentence."


class TestLLMResult:
    def test_defaults(self):
        result = LLMResult(full_text="Hello world")
        assert result.full_text == "Hello world"
        assert result.sentences == []
        assert result.prompt_tokens == 0
        assert result.completion_tokens == 0
        assert result.total_tokens == 0
        assert result.model == ""
        assert result.duration_ms == 0.0

    def test_total_chars(self):
        result = LLMResult(full_text="abc")
        assert result.total_chars == 3

    def test_total_chars_empty(self):
        result = LLMResult(full_text="")
        assert result.total_chars == 0


class TestConversationHistory:
    def test_creation(self):
        hist = ConversationHistory(system_prompt="Be helpful")
        assert hist.system_prompt == "Be helpful"
        assert hist.max_messages == 20
        assert hist.is_empty is True
        assert hist.message_count == 0

    def test_add_user_message(self):
        hist = ConversationHistory(system_prompt="sys")
        hist.add_user_message("hello")
        assert hist.message_count == 1
        assert hist.is_empty is False

    def test_add_assistant_message(self):
        hist = ConversationHistory(system_prompt="sys")
        hist.add_assistant_message("hi there")
        assert hist.message_count == 1

    def test_get_messages_includes_system(self):
        hist = ConversationHistory(system_prompt="Be helpful")
        hist.add_user_message("hello")
        messages = hist.get_messages()
        assert len(messages) == 2
        assert messages[0] == {"role": "system", "content": "Be helpful"}
        assert messages[1] == {"role": "user", "content": "hello"}

    def test_get_messages_empty_still_has_system(self):
        hist = ConversationHistory(system_prompt="sys")
        messages = hist.get_messages()
        assert len(messages) == 1
        assert messages[0]["role"] == "system"

    def test_clear(self):
        hist = ConversationHistory(system_prompt="sys")
        hist.add_user_message("a")
        hist.add_assistant_message("b")
        hist.clear()
        assert hist.is_empty is True
        assert hist.message_count == 0
        # System prompt still accessible via get_messages
        assert len(hist.get_messages()) == 1

    def test_trimming(self):
        hist = ConversationHistory(system_prompt="sys", max_messages=2)
        # _trim is called on add_user_message only, keeps last max_messages*2 raw msgs
        for i in range(3):
            hist.add_user_message(f"q{i}")
            hist.add_assistant_message(f"a{i}")
        # After q2 trim: keeps last 4 → [a0,q1,a1,q2], then a2 appended → 5
        assert hist.message_count == 5
        messages = hist.get_messages()
        assert messages[1]["content"] == "a0"

    def test_trimming_preserves_order(self):
        hist = ConversationHistory(system_prompt="sys", max_messages=1)
        hist.add_user_message("old")
        hist.add_assistant_message("old-reply")
        hist.add_user_message("new")
        # After adding "new", trim keeps last 2 messages (1 pair)
        assert hist.message_count == 2
        messages = hist.get_messages()
        assert messages[1]["content"] == "old-reply"
        assert messages[2]["content"] == "new"


class TestPipelineEventType:
    def test_status_events_exist(self):
        assert PipelineEventType.LISTENING
        assert PipelineEventType.PROCESSING
        assert PipelineEventType.THINKING
        assert PipelineEventType.SPEAKING
        assert PipelineEventType.IDLE

    def test_asr_events_exist(self):
        assert PipelineEventType.TRANSCRIPT

    def test_llm_events_exist(self):
        assert PipelineEventType.LLM_TOKEN
        assert PipelineEventType.LLM_SENTENCE
        assert PipelineEventType.LLM_DONE

    def test_control_events_exist(self):
        assert PipelineEventType.ABORT
        assert PipelineEventType.HEARTBEAT
        assert PipelineEventType.CLEANUP


class TestPipelineEvent:
    def test_creation_defaults(self):
        event = PipelineEvent(type=PipelineEventType.IDLE)
        assert event.type == PipelineEventType.IDLE
        assert event.data == {}
        assert event.session_id is None

    def test_creation_with_data(self):
        event = PipelineEvent(
            type=PipelineEventType.LLM_TOKEN,
            data={"token": "hi"},
            session_id="sess1",
        )
        assert event.data["token"] == "hi"
        assert event.session_id == "sess1"


class TestEvShorthand:
    def test_ev_creates_event(self):
        event = ev(PipelineEventType.TRANSCRIPT, text="hello")
        assert event.type == PipelineEventType.TRANSCRIPT
        assert event.data == {"text": "hello"}

    def test_ev_no_kwargs(self):
        event = ev(PipelineEventType.IDLE)
        assert event.data == {}
