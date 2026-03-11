"""
Chat domain ports — abstract interfaces for LLM and prompt building.

Extracted from:
  - app.services.llm.base (BaseLLMProvider → LLMPort)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator, Callable

from app.domain.chat.entities import ConversationHistory, LLMChunk, LLMResult


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
