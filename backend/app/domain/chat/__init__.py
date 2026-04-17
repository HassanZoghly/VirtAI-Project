"""Chat subdomain — LLM interaction, conversation management, prompt policies."""

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
from app.domain.chat.policies import (
    AVATAR_PROMPTS,
    DEFAULT_PROMPT,
    EMOTION_INSTRUCTIONS,
    MAX_MESSAGES_DEFAULT,
    build_conversation,
    get_system_prompt,
)
from app.domain.chat.ports import BaseLLMProvider, LLMPort, PromptBuilderPort

__all__ = [
    "AVATAR_PROMPTS",
    "DEFAULT_PROMPT",
    "EMOTION_INSTRUCTIONS",
    "MAX_MESSAGES_DEFAULT",
    "BaseLLMProvider",
    "ChatMessage",
    "ConversationHistory",
    "LLMChunk",
    "LLMPort",
    "LLMResult",
    "MessageRole",
    "PipelineEvent",
    "PipelineEventType",
    "PromptBuilderPort",
    "build_conversation",
    "ev",
    "get_system_prompt",
]
