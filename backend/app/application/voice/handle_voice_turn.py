"""
Voice turn use case — orchestrates the full ASR → LLM → TTS pipeline.

Canonical location for ConversationPipeline (port-typed).
All dependencies are injected via domain port interfaces.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import TYPE_CHECKING

from loguru import logger

from app.application.voice.filler_coordinator import FillerCoordinator
from app.application.voice.pipeline_context import TurnContext
from app.application.voice.pipeline_stages import (
    AnimationStage,
    LLMStage,
    SentenceSegmentationStage,
    TTSStage,
)
from app.application.voice.turn_persistence import TurnPersistenceManager
from app.domain.chat.policies import build_conversation
from app.domain.chat.ports import BaseLLMProvider, ChatContextCachePort
from app.domain.voice.ports import BaseTTSProvider, StreamingASRService
from app.shared.config import get_settings

if TYPE_CHECKING:
    from app.application.rag.intent_classifier import IntentClassifier
    from app.application.rag.retrieval_use_case import RetrievalUseCase


async def _safe_task(coro: Awaitable[None], name: str = "task") -> None:
    """Wrapper to ensure TaskGroup child exceptions are logged immediately."""
    try:
        await coro
    except asyncio.CancelledError:
        raise
    except Exception as e:
        logger.error(f"TaskGroup child '{name}' failed with non-fatal error: {e}")
        # Do not raise to prevent sibling cancellation.


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
        intent_classifier: IntentClassifier | None = None,
        avatar_id: str = "avatar1",
        tts_voice: str | None = None,
        persist_turn: Callable[[str, str, str, str, str | None], Awaitable[None]] | None = None,
    ):
        self._asr = asr
        self._llm = llm
        self._tts = tts
        self._retrieval = retrieval
        self._intent_classifier = intent_classifier
        self.avatar_id = avatar_id
        self._context_cache = context_cache
        self._history = build_conversation(avatar_id)
        self.tts_voice = tts_voice or getattr(tts, "voice", None)

        self._persistence = TurnPersistenceManager(persist_turn, context_cache)
        self._filler_coordinator = FillerCoordinator(tts_provider=self._tts)

        # Stages setup
        self.llm_stage = LLMStage(llm=self._llm, retrieval=self._retrieval, intent_classifier=self._intent_classifier)
        self.sentence_stage = SentenceSegmentationStage()
        self.tts_stage = TTSStage(tts=self._tts)
        self.animation_stage = animation_stage or AnimationStage(
            animation_service=None, viseme_generator=None
        )

        # State tracking
        self._current_context: TurnContext | None = None
        self._current_message_id: str | None = None
        self._running_tasks: list[asyncio.Task] = []
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
            tts_voice=self.tts_voice,
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

            await self._persistence.persist_user_input(session_id, text, trace_id)

            await send_callback(
                make_user_message_echo(
                    session_id=session_id,
                    message_id=message_id,
                    text=text,
                    conversation_id=session_id,
                )
            )

            await self._persistence.rebuild_history_if_needed(session_id, self._history)

            self._history.add_user_message(text)
            await send_callback(make_pipeline_state(session_id, "thinking", message_id))

            async def _llm_with_sentinel():
                try:
                    await self.llm_stage.process(context)
                finally:
                    with suppress(Exception):
                        await context.sentence_queue.put(None)

            async def process_audio():
                try:
                    while not context.aborted:
                        try:
                            sentence = await asyncio.wait_for(context.sentence_queue.get(), timeout=60.0)
                        except asyncio.TimeoutError:
                            break
                        if sentence is None:
                            break

                        context.current_sentence = sentence
                        await self.tts_stage.process(context)
                        if context.aborted:
                            break
                        await self.animation_stage.process(context)
                        context.sentence_index += 1
                except Exception as e:
                    logger.error(f"process_audio crashed: {e} | trace_id={trace_id}")
                    await send_callback(
                        make_error(
                            code="PIPELINE_AUDIO_ERROR",
                            message=f"Audio pipeline failed: {str(e)}",
                            session_id=session_id,
                            message_id=message_id,
                        )
                    )
                    context.abort()

            settings = get_settings()

            try:
                async with asyncio.TaskGroup() as tg:
                    t1 = tg.create_task(_safe_task(_llm_with_sentinel(), "llm_stage"))
                    t2 = tg.create_task(_safe_task(process_audio(), "audio_stage"))
                    self._running_tasks.extend([t1, t2])
                    if settings.ENABLE_FILLER_AUDIO:
                        t3 = tg.create_task(
                            _safe_task(
                                self._filler_coordinator.run_filler_task(
                                    context, self._history, self.tts_voice, send_callback
                                ),
                                "filler_task"
                            )
                        )
                        self._running_tasks.append(t3)
            except Exception:
                context.abort()
                raise

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
            if context.llm_full_response:
                tts_key = None
                if self._tts:
                    try:
                        tts_key = self._tts.generate_cache_key(context.llm_full_response, voice=self.tts_voice)
                    except Exception as e:
                        logger.warning(f"Failed to generate TTS cache key: {e}")

                await self._persistence.persist_assistant_output(
                    session_id, context.llm_full_response, tts_key, trace_id
                )

            with suppress(Exception):
                await send_callback(make_pipeline_state(session_id, "idle", message_id))
            self._current_message_id = None
            self._current_context = None
            self._running_tasks.clear()
            logger.info(
                f"Pipeline complete | session={session_id} | message={message_id} | trace_id={trace_id}"
            )

    def abort(self) -> None:
        if self._current_context:
            self._current_context.abort()
        for task in self._running_tasks:
            if not task.done():
                task.cancel()
        self._running_tasks.clear()
        logger.info("Pipeline abort requested")

    def set_tts_voice(self, voice_id: str | None) -> None:
        if not voice_id:
            return
        self.tts_voice = voice_id
        if self._current_context is not None:
            self._current_context.tts_voice = voice_id
        if self._tts is not None and hasattr(self._tts, "voice"):
            self._tts.voice = voice_id

    def reset_history(self) -> None:
        self._history.clear()
        logger.info("Conversation history cleared")

    def change_avatar(self, avatar_id: str) -> None:
        self._history = build_conversation(avatar_id)
        self.avatar_id = avatar_id
        logger.info(f"Avatar changed to {avatar_id}")

    @property
    def tts(self) -> BaseTTSProvider | None:
        return self._tts

    async def invalidate_context(self, session_id: str) -> None:
        if self._context_cache:
            await self._context_cache.invalidate(session_id)

    @property
    def history_length(self) -> int:
        return self._history.message_count
