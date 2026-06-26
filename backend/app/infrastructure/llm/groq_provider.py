"""
LLM Provider using Groq API with streaming support.

Why Groq for LLM?
- Fastest inference available (LPU hardware)
- llama-3.1-8b-instant → sub-second first token
- Full streaming support
- Same API key as ASR
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncGenerator, Callable
from typing import Any, cast

from groq import AsyncGroq
from loguru import logger

from app.domain.chat.entities import ConversationHistory, LLMChunk, LLMResult
from app.domain.chat.ports import BaseLLMProvider
from app.infrastructure.llm.sentence_splitter import SentenceSplitter
from app.shared.config import get_settings
from app.shared.errors import LLMException


class GroqLLMProvider(BaseLLMProvider):
    """
    LLM Provider using Groq's Chat Completions API.
    Streaming Pipeline:
        token arrives
            → accumulate in SentenceSplitter
            → yield LLMChunk(token=token)        ← frontend shows typing
            → if sentence complete:
                → yield LLMChunk(sentence=sent)  ← pipeline triggers TTS

    Configuration is injected via constructor parameters.
    """

    def __init__(
        self,
        model: str = "llama-3.3-70b-versatile",
        max_tokens: int = 512,
        temperature: float = 0.7,
        api_key: str | None = None,
    ):
        """
        Initialize GroqLLMProvider with configuration.

        Args:
            model: Model identifier (e.g., "llama-3.3-70b-versatile")
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature (0.0 to 2.0)
            api_key: Groq API key (optional, falls back to settings.GROQ_API_KEY)

        Raises:
            ValueError: If api_key is not provided and not in settings
        """
        settings = get_settings()
        api_key = api_key or settings.GROQ_API_KEY
        if not api_key:
            raise ValueError("api_key is required for GroqLLMProvider. Set GROQ_API_KEY in .env")

        self.model = model
        self.max_tokens = max_tokens
        self.temperature = temperature
        self._client = AsyncGroq(api_key=api_key)
        logger.info(
            f"GroqLLMProvider initialized | "
            f"model={self.model} | "
            f"max_tokens={self.max_tokens} | "
            f"temperature={self.temperature}"
        )

    # ── Private Helpers ───────────────────────────────────────────────────────
    def _extract_usage(self, chunk) -> dict | None:
        """Extracts token usage from the final streaming chunk."""
        try:
            u = None
            # Legacy path: chunk.x_groq.usage
            x_groq = getattr(chunk, "x_groq", None)
            if x_groq and hasattr(x_groq, "usage"):
                u = x_groq.usage
            # Current SDK path: chunk.usage directly
            if u is None:
                raw = getattr(chunk, "usage", None)
                if raw is not None:
                    u = raw
            if u is None:
                return None
            return {
                "prompt_tokens": getattr(u, "prompt_tokens", 0),
                "completion_tokens": getattr(u, "completion_tokens", 0),
                "total_tokens": getattr(u, "total_tokens", 0),
            }
        except Exception:
            pass
        return None

    def _log_usage(self, usage: dict | None, duration_ms: float) -> None:
        if usage:
            logger.info(
                f"LLM usage | "
                f"prompt={usage['prompt_tokens']} | "
                f"completion={usage['completion_tokens']} | "
                f"total={usage['total_tokens']} | "
                f"duration={duration_ms:.0f}ms"
            )

    # ── Public Methods ────────────────────────────────────────────────────────
    async def stream(
        self,
        history: ConversationHistory,
        on_sentence: Callable[[str], None] | None = None,
        trace_id: str | None = None,
    ) -> AsyncGenerator[LLMChunk, None]:
        """
        Streams tokens from Groq LLM.
        Yields:
            LLMChunk(token=t)          → every token (for typing indicator)
            LLMChunk(sentence=s)       → when a full sentence is ready (for TTS)
            LLMChunk(is_done=True)     → stream finished
        Args:
            history    : conversation history including system prompt
            on_sentence: optional sync callback fired on each complete sentence
        """
        messages = history.get_messages()
        splitter = SentenceSplitter()
        full_text: list[str] = []
        usage: dict | None = None
        start_time = time.perf_counter()
        token_count = 0
        sentence_count = 0
        logger.info(
            f"LLM stream start | "
            f"model={self.model} | "
            f"messages={len(messages)} | "
            f"history_pairs={history.message_count // 2} | "
            f"trace_id={trace_id}"
        )

        # ── Open Groq stream ──────────────────────────────────────────────────
        groq_stream: Any = None
        try:
            from tenacity import AsyncRetrying, stop_after_attempt, wait_exponential

            async for attempt in AsyncRetrying(
                wait=wait_exponential(multiplier=1, min=2, max=10),
                stop=stop_after_attempt(3),
                reraise=True,
            ):
                with attempt:
                    groq_stream = await self._client.chat.completions.create(
                        model=self.model,
                        messages=cast("list[Any]", messages),
                        max_tokens=self.max_tokens,
                        temperature=self.temperature,
                        stream=True,
                    )
        except Exception as e:
            logger.error(f"Groq LLM stream init failed: {e} | trace_id={trace_id}")
            raise LLMException(f"LLM stream failed: {e!s}") from e

        # ── Process stream ────────────────────────────────────────────────────
        try:
            async for chunk in groq_stream:
                # Extract token
                delta = chunk.choices[0].delta if chunk.choices else None
                token = getattr(delta, "content", None) if delta else None

                # Try to get usage from last chunk
                if not usage:
                    usage = self._extract_usage(chunk)
                if token is None:
                    continue

                token_count += 1
                full_text.append(token)

                # Yield every token immediately → frontend typing indicator
                yield LLMChunk(token=token)

                # Feed into sentence splitter — yields complete sentences for TTS
                for char in token:
                    sentence = splitter.feed(char)
                    if sentence:
                        sentence_count += 1
                        logger.debug(f"Sentence ready | len={len(sentence)} | '{sentence[:40]}...'")

                        if on_sentence:
                            on_sentence(sentence)

                        yield LLMChunk(token="", sentence=sentence)

        except asyncio.CancelledError:
            logger.warning(
                f"LLM stream cancelled mid-generation. Closing Groq stream to save API tokens. | trace_id={trace_id}"
            )
            if hasattr(groq_stream, "close"):
                await groq_stream.close()
            raise
        except Exception as e:
            logger.error(f"LLM stream error during iteration: {e} | trace_id={trace_id}")
            raise LLMException(f"LLM stream error: {e!s}") from e

        # ── Flush remaining buffer ────────────────────────────────────────────
        remainder = splitter.flush()
        if remainder:
            sentence_count += 1
            logger.debug(f"Flushing remainder | len={len(remainder)} | '{remainder[:40]}'")
            if on_sentence:
                on_sentence(remainder)
            yield LLMChunk(token="", sentence=remainder)

        # ── Done ──────────────────────────────────────────────────────────────
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        self._log_usage(usage, elapsed_ms)
        logger.success(
            f"LLM stream done | "
            f"tokens={token_count} | "
            f"elapsed={elapsed_ms:.0f}ms | "
            f"sentences={sentence_count} | "
            f"trace_id={trace_id}"
        )
        yield LLMChunk(token="", is_done=True)

    async def complete(
        self,
        history: ConversationHistory,
        response_format: dict | None = None,
    ) -> LLMResult:
        """
        Non-streaming completion.
        Collects the full response then returns it.
        Useful for short internal tasks (e.g. generating a title).
        """
        messages = history.get_messages()
        start_time = time.perf_counter()
        logger.info(f"LLM complete | model={self.model} | messages={len(messages)}")
        response: Any = None
        try:
            from tenacity import AsyncRetrying, stop_after_attempt, wait_exponential

            async for attempt in AsyncRetrying(
                wait=wait_exponential(multiplier=1, min=2, max=10),
                stop=stop_after_attempt(3),
                reraise=True,
            ):
                with attempt:
                    kwargs = {
                        "model": self.model,
                        "messages": cast("list[Any]", messages),
                        "max_tokens": self.max_tokens,
                        "temperature": self.temperature,
                        "stream": False,
                    }
                    if response_format:
                        kwargs["response_format"] = response_format

                    response = await self._client.chat.completions.create(**kwargs)

        except Exception as e:
            logger.error(f"Groq LLM complete failed: {e}")
            raise LLMException(f"LLM complete failed: {e!s}") from e
        elapsed_ms = (time.perf_counter() - start_time) * 1000

        full_text = response.choices[0].message.content or ""

        # Split into sentences for convenience
        splitter = SentenceSplitter()
        sentences: list[str] = []
        for char in full_text:
            sent = splitter.feed(char)
            if sent:
                sentences.append(sent)
        remainder = splitter.flush()
        if remainder:
            sentences.append(remainder)

        # Usage
        usage = response.usage
        prompt_tokens = getattr(usage, "prompt_tokens", 0)
        completion_tokens = getattr(usage, "completion_tokens", 0)
        total_tokens = getattr(usage, "total_tokens", 0)
        logger.success(
            f"LLM complete done | "
            f"elapsed={elapsed_ms:.0f}ms | "
            f"tokens={total_tokens} | "
            f"sentences={len(sentences)}"
        )
        return LLMResult(
            full_text=full_text,
            sentences=sentences,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            model=self.model,
            duration_ms=elapsed_ms,
        )

    async def is_available(self) -> bool:
        """Quick health check against Groq API."""
        try:
            history = ConversationHistory(system_prompt="")
            history.add_user_message("Hi")
            result = await self.complete(history)
            return bool(result.full_text)
        except Exception as e:
            logger.warning(f"LLM health check failed: {e}")
            return False
