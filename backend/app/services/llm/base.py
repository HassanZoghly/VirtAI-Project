"""Backward-compat shim - canonical source is app.domain.chat.entities + app.domain.chat.ports."""
from app.domain.chat.entities import (  # noqa: F401
    ChatMessage,
    ConversationHistory,
    LLMChunk,
    LLMResult,
    MessageRole,
)
from app.domain.chat.ports import BaseLLMProvider  # noqa: F401
