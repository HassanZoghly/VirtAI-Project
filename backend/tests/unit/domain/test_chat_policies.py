"""Tests for chat domain policies — avatar prompts and conversation building."""

from app.domain.chat.entities import ConversationHistory
from app.domain.chat.policies import (
    AVATAR_PROMPTS,
    DEFAULT_PROMPT,
    EMOTION_INSTRUCTIONS,
    MAX_MESSAGES_DEFAULT,
    build_conversation,
    get_system_prompt,
)


class TestConstants:
    def test_max_messages_default(self):
        assert MAX_MESSAGES_DEFAULT == 20

    def test_emotion_instructions_contains_tags(self):
        assert "[emotion:NAME]" in EMOTION_INSTRUCTIONS
        assert "neutral" in EMOTION_INSTRUCTIONS
        assert "happy" in EMOTION_INSTRUCTIONS

    def test_avatar_prompts_has_three_avatars(self):
        assert "avatar1" in AVATAR_PROMPTS
        assert "avatar2" in AVATAR_PROMPTS
        assert "avatar3" in AVATAR_PROMPTS

    def test_default_prompt_is_avatar1(self):
        assert DEFAULT_PROMPT == AVATAR_PROMPTS["avatar1"]


class TestGetSystemPrompt:
    def test_default_no_avatar(self):
        prompt = get_system_prompt()
        assert DEFAULT_PROMPT in prompt
        assert EMOTION_INSTRUCTIONS in prompt

    def test_default_none_avatar(self):
        prompt = get_system_prompt(None)
        assert DEFAULT_PROMPT in prompt

    def test_avatar1(self):
        prompt = get_system_prompt("avatar1")
        assert "Dr. Omar" in prompt
        assert EMOTION_INSTRUCTIONS in prompt

    def test_avatar2(self):
        prompt = get_system_prompt("avatar2")
        assert "Dr. Mariam" in prompt
        assert EMOTION_INSTRUCTIONS in prompt

    def test_avatar3(self):
        prompt = get_system_prompt("avatar3")
        assert "Dr. Khaled" in prompt
        assert EMOTION_INSTRUCTIONS in prompt

    def test_unknown_avatar_falls_back_to_default(self):
        prompt = get_system_prompt("nonexistent")
        assert DEFAULT_PROMPT in prompt

    def test_emotion_instructions_always_appended(self):
        for avatar_id in ["avatar1", "avatar2", "avatar3", None, "unknown"]:
            prompt = get_system_prompt(avatar_id)
            assert EMOTION_INSTRUCTIONS in prompt


class TestBuildConversation:
    def test_returns_conversation_history(self):
        conv = build_conversation()
        assert isinstance(conv, ConversationHistory)

    def test_default_max_messages(self):
        conv = build_conversation()
        assert conv.max_messages == 20

    def test_custom_max_messages(self):
        conv = build_conversation(max_messages=10)
        assert conv.max_messages == 10

    def test_system_prompt_matches_avatar(self):
        conv = build_conversation(avatar_id="avatar2")
        messages = conv.get_messages()
        assert "Dr. Mariam" in messages[0]["content"]

    def test_starts_empty(self):
        conv = build_conversation()
        assert conv.is_empty
        assert conv.message_count == 0

    def test_conversation_is_functional(self):
        conv = build_conversation(avatar_id="avatar1")
        conv.add_user_message("What is Python?")
        conv.add_assistant_message("[emotion:happy] Python is a programming language.")
        assert conv.message_count == 2
        messages = conv.get_messages()
        assert len(messages) == 3  # system + user + assistant
