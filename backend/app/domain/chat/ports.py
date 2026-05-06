"""
Chat domain ports — abstract interfaces for LLM and prompt building.

Extracted from:
  - app.services.llm.base (BaseLLMProvider → LLMPort)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator, Callable

from app.domain.chat.entities import ConversationHistory, LLMChunk, LLMResult


class ChatRepositoryPort(ABC):
    """Abstract interface for chat session and message persistence."""

    @abstractmethod
    async def create_chat_session(self, user_id: str, title: str = "New Chat", session_id: str | None = None) -> dict: ...

    @abstractmethod
    async def get_chat_session(self, session_id: str) -> dict | None: ...

    @abstractmethod
    async def touch_chat_session(self, session_id: str) -> None: ...

    @abstractmethod
    async def list_user_sessions(self, user_id: str, archived: bool = False, limit: int = 50) -> list[dict]: ...

    @abstractmethod
    async def archive_chat_session(self, session_id: str) -> None: ...

    @abstractmethod
    async def delete_chat_session(self, session_id: str) -> bool: ...

    @abstractmethod
    async def save_message(self, session_id: str, role: str, content: str, input_type: str = "text", tts_cache_key: str | None = None, sources: list[dict] | None = None) -> dict: ...

    @abstractmethod
    async def get_session_messages(self, session_id: str, limit: int = 50) -> list[dict]: ...

    @abstractmethod
    async def get_message_count(self, session_id: str) -> int: ...


class BaseLLMProvider(ABC):
    """Abstract LLM provider interface."""

    @abstractmethod
    async def stream(
        self,
        history: ConversationHistory,
        on_sentence: Callable[[str], None] | None = None,
    ) -> AsyncGenerator[LLMChunk, None]:
        """
        Streams tokens from the LLM.
        Yields LLMChunk for each token.
        When a full sentence is detected → sets chunk.sentence.
        """
        yield  # pragma: no cover

    @abstractmethod
    async def complete(
        self,
        history: ConversationHistory,
    ) -> LLMResult:
        """Non-streaming completion (for simple cases)"""
        ...

    @abstractmethod
    async def is_available(self) -> bool:
        """Health check"""
        ...


# Hexagonal alias
LLMPort = BaseLLMProvider


class PromptBuilderPort(ABC):
    """Abstract interface for building system prompts."""

    @abstractmethod
    def get_system_prompt(self, avatar_id: str | None = None) -> str:
        """Returns the system prompt for the given avatar."""
        ...

    @abstractmethod
    def build_conversation(
        self,
        avatar_id: str | None = None,
        max_messages: int = 20,
    ) -> ConversationHistory:
        """Creates a fresh ConversationHistory for the given avatar."""
        ...


class ChatRepositoryPort(ABC):
    """Abstract interface for chat persistence."""

    @abstractmethod
    async def create_chat_session(self, user_id: str, session_id: str | None = None) -> dict:
        ...

    @abstractmethod
    async def get_chat_session(self, session_id: str) -> dict | None:
        ...
