"""
Voice turn use case — orchestrates the full ASR → LLM → TTS pipeline.

Canonical location for ConversationPipeline (port-typed).
All dependencies are injected via domain port interfaces.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from loguru import logger

from app.application.voice.pipeline_context import TurnContext
from app.application.voice.pipeline_stages import (
    AnimationStage,
    LLMStage,
    SentenceSegmentationStage,
    TTSStage,
)
from app.domain.chat.policies import build_conversation
from app.domain.chat.ports import BaseLLMProvider, ChatContextCachePort
from app.domain.voice.ports import BaseTTSProvider, StreamingASRService

if TYPE_CHECKING:
    from app.application.rag.retrieval_use_case import RetrievalUseCase


class ConversationPipeline:
    """Manages the full conversation pipeline for one WebSocket session."""

    def __init__(
        self,
        asr: StreamingASRService | None = None,
        llm: BaseLLMProvider | None = None,
        tts: BaseTTSProvider | None = None,
        retrieval: RetrievalUseCase | None = None,
        animation_stage: AnimationStage | None = None,
        context_cache: ChatContextCachePort | None = None,
        avatar_id: str = "avatar1",
        persist_turn: Callable[[str, str, str, str, str | None], Awaitable[None]] | None = None,
    ):
        self._asr = asr
        self._llm = llm
        self._tts = tts
        self._retrieval = retrieval
        self.avatar_id = avatar_id
        self._persist_turn = persist_turn
        self._context_cache = context_cache
        self._history = build_conversation(avatar_id)

        # Stages setup
        self.llm_stage = LLMStage(llm=self._llm, retrieval=self._retrieval)
        self.sentence_stage = SentenceSegmentationStage()
        self.tts_stage = TTSStage(tts=self._tts)
        self.animation_stage = animation_stage or AnimationStage(
            animation_service=None, viseme_generator=None
        )

        # State tracking
        self._current_context: TurnContext | None = None
        self._current_message_id: str | None = None
        logger.info(f"ConversationPipeline created | avatar={avatar_id}")

    # ── Public API ────────────────────────────────────────────────────────────

    async def process_message(
        self,
        message_id: str,
        text: str,
        session_id: str,
        send_callback: Callable,
        send_binary_callback: Callable | None = None,
        trace_id: str | None = None,
    ) -> None:
        """Sequential processing using decoupled stages."""
        from app.schemas.ws_messages import make_error, make_pipeline_state, make_user_message_echo

        self._current_message_id = message_id

        context = TurnContext(
            session_id=session_id,
            message_id=message_id,
            trace_id=trace_id or str(message_id),
            text_input=text,
            history=self._history,
            send_callback=send_callback,
            send_binary_callback=send_binary_callback,
        )
        self._current_context = context

        try:
            if not text.strip():
                await send_callback(
                    make_error(
                        code="EMPTY_INPUT",
                        message="Empty text input",
                        session_id=session_id,
                        message_id=message_id,
                    )
                )
                return

            # Input Persistence
            try:
                if self._persist_turn:
                    await self._persist_turn(session_id, "user", text, "text", None)
            except Exception as e:
                logger.warning(
                    f"[Pipeline] Failed to persist user message: {e} | trace_id={trace_id}"
                )

            await send_callback(
                make_user_message_echo(
                    session_id=session_id,
                    message_id=message_id,
                    text=text,
                    conversation_id=session_id,
                )
            )
            if self._context_cache:
                await self._context_cache.push_message(session_id, "user", text)

            if self._history.is_empty and self._context_cache:
                ctx_messages = await self._context_cache.get_or_rebuild_context(session_id)
                for msg in ctx_messages[:-1]:
                    if msg["role"] == "user":
                        self._history.add_user_message(msg["content"])
                    elif msg["role"] == "assistant":
                        self._history.add_assistant_message(msg["content"])

            self._history.add_user_message(text)
            await send_callback(make_pipeline_state(session_id, "thinking"))

            # Execute pipeline stages concurrently for streaming
            # LLMStage pushes to sentence_queue.
            # Audio task pulls from sentence_queue and runs TTS+Animation sequentially per chunk.
            llm_task = asyncio.create_task(self.llm_stage.process(context))

            async def process_audio():
                while not context.aborted:
                    sentence = await context.sentence_queue.get()
                    if sentence is None:
                        break

                    context.current_sentence = sentence
                    await self.tts_stage.process(context)
                    if context.aborted:
                        break
                    await self.animation_stage.process(context)

            audio_task = asyncio.create_task(process_audio())

            await asyncio.gather(llm_task, audio_task)

            # Output Persistence
            if context.llm_full_response and not context.aborted:
                tts_key: str | None = None
                try:
                    if self._tts:
                        tts_key = self._tts.generate_cache_key(context.llm_full_response)

                    if self._persist_turn:
                        await self._persist_turn(
                            session_id, "assistant", context.llm_full_response, "text", tts_key
                        )
                except Exception as e:
                    logger.warning(
                        f"[Pipeline] Failed to persist assistant message: {e} | trace_id={trace_id}"
                    )

                if self._context_cache:
                    await self._context_cache.push_message(
                        session_id,
                        "assistant",
                        context.llm_full_response,
                        extra={"tts_cache_key": tts_key} if tts_key else None,
                    )

        except asyncio.CancelledError:
            context.abort()
            logger.info(
                f"Pipeline cancelled | session={session_id} | message={message_id} | trace_id={trace_id}"
            )
            return
        except Exception as e:
            logger.error(f"Pipeline error: {e} | trace_id={trace_id}")
            await send_callback(
                make_error(
                    code="PIPELINE_ERROR",
                    message=str(e),
                    session_id=session_id,
                    message_id=message_id,
                )
            )
        finally:
            await send_callback(make_pipeline_state(session_id, "idle"))
            self._current_message_id = None
            self._current_context = None
            logger.info(
                f"Pipeline complete | session={session_id} | message={message_id} | trace_id={trace_id}"
            )

    def abort(self) -> None:
        if self._current_context:
            self._current_context.abort()
        logger.info("Pipeline abort requested")

    def reset_history(self) -> None:
        self._history.clear()
        logger.info("Conversation history cleared")

    def change_avatar(self, avatar_id: str) -> None:
        self._history = build_conversation(avatar_id)
        self.avatar_id = avatar_id
        logger.info(f"Avatar changed to {avatar_id}")

    @property
    def history_length(self) -> int:
        return self._history.message_count
