"""
Pure LLM streaming use case — streams LLM tokens without TTS.

Used for text-only chat flows where TTS/visemes are not needed.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Optional

from loguru import logger

from app.domain.chat.entities import ConversationHistory, LLMChunk
from app.domain.chat.ports import BaseLLMProvider


class StreamLLMResponse:
    """
    Streams raw LLM tokens for a given conversation history.

    Depends only on the LLM domain port — no TTS or ASR involved.
    """

    __slots__ = ("_llm",)

    def __init__(self, llm: BaseLLMProvider) -> None:
        self._llm = llm

    async def execute(
        self,
        history: ConversationHistory,
        on_sentence: Optional[callable] = None,
    ) -> AsyncGenerator[LLMChunk, None]:
        """
        Stream LLM chunks for a conversation history.

        Args:
            history: The conversation history to continue.
            on_sentence: Optional callback invoked when a full sentence is detected.

        Yields:
            LLMChunk objects with token text and metadata.
        """
        logger.debug("StreamLLMResponse: starting LLM stream")
        async for chunk in self._llm.stream(history, on_sentence=on_sentence):
            yield chunk
        logger.debug("StreamLLMResponse: LLM stream complete")

    async def complete(self, history: ConversationHistory):
        """One-shot completion (non-streaming)."""
        return await self._llm.complete(history)
