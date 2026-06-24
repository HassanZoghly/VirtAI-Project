from contextlib import suppress
from typing import Any, Awaitable, Callable

from loguru import logger

from app.domain.chat.ports import ChatContextCachePort


class TurnPersistenceManager:
    def __init__(
        self,
        persist_turn: Callable[[str, str, str, str, str | None], Awaitable[None]] | None,
        context_cache: ChatContextCachePort | None,
    ):
        self._persist_turn = persist_turn
        self._context_cache = context_cache

    async def persist_user_input(self, session_id: str, text: str, trace_id: str | None) -> None:
        try:
            if self._persist_turn:
                await self._persist_turn(session_id, "user", text, "text", None)
        except Exception as e:
            logger.warning(
                f"[Pipeline] Failed to persist user message: {e} | trace_id={trace_id}"
            )

        if self._context_cache:
            with suppress(Exception):
                await self._context_cache.push_message(session_id, "user", text)

    async def rebuild_history_if_needed(self, session_id: str, history: Any) -> None:
        if history.is_empty and self._context_cache:
            ctx_messages = await self._context_cache.get_or_rebuild_context(session_id)
            for msg in ctx_messages[:-1]:
                if msg["role"] == "user":
                    history.add_user_message(msg["content"])
                elif msg["role"] == "assistant":
                    history.add_assistant_message(msg["content"])

    async def persist_assistant_output(
        self, session_id: str, text: str, tts_key: str | None, trace_id: str | None
    ) -> None:
        try:
            if self._persist_turn:
                await self._persist_turn(session_id, "assistant", text, "text", tts_key)
        except Exception as e:
            logger.warning(
                f"[Pipeline] Failed to persist assistant message: {e} | trace_id={trace_id}"
            )

        if self._context_cache:
            with suppress(Exception):
                await self._context_cache.push_message(
                    session_id,
                    "assistant",
                    text,
                    extra={"tts_cache_key": tts_key} if tts_key else None,
                )
