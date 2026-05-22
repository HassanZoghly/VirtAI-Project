"""Chat domain ports — abstract interfaces for LLM and prompt building."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator, Callable

from app.domain.chat.entities import ConversationHistory, LLMChunk, LLMResult


class ChatRepositoryPort(ABC):
    """Abstract interface for chat session and message persistence."""

    @abstractmethod
    async def create_chat_session(
        self, user_id: str, title: str = "New Chat", session_id: str | None = None
    ) -> dict: ...

    @abstractmethod
    async def get_chat_session(self, session_id: str) -> dict | None: ...

    @abstractmethod
    async def list_user_sessions(
        self, user_id: str, archived: bool = False, limit: int = 50
    ) -> list[dict]: ...

    @abstractmethod
    async def delete_chat_session(self, session_id: str) -> bool: ...

    @abstractmethod
    async def save_message(
        self,
        session_id: str,
        role: str,
        content: str,
        input_type: str = "text",
        tts_cache_key: str | None = None,
        sources: list[dict] | None = None,
    ) -> dict: ...

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
        trace_id: str | None = None,
    ) -> AsyncGenerator[LLMChunk, None]:
        """
        Streams tokens from the LLM.
        Yields LLMChunk for each token.
        When a full sentence is detected → sets chunk.sentence.
        """
        ...

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
