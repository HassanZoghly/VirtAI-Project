"""
Voice turn use case — orchestrates the full ASR → LLM → TTS pipeline.

Canonical location for ConversationPipeline (port-typed).
All dependencies are injected via domain port interfaces.
"""

from __future__ import annotations

import asyncio
import base64
import re
import time
from collections import defaultdict
from collections.abc import AsyncGenerator, Callable
from typing import TYPE_CHECKING

from loguru import logger

from app.application.animation.intelligence_service import AnimationIntelligenceService
from app.domain.chat.entities import ConversationHistory, PipelineEvent, PipelineEventType, ev
from app.domain.chat.policies import build_conversation
from app.domain.chat.ports import BaseLLMProvider
from app.domain.voice.ports import BaseTTSProvider, StreamingASRService
from app.infrastructure.asr.audio_pipeline import pcm_bytes_to_float32
from app.shared.config import get_settings
from app.shared.errors import ASRException

from app.application.voice.pipeline_context import TurnContext
from app.application.voice.pipeline_stages import (
    ASRStage, LLMStage, SentenceSegmentationStage, TTSStage, AnimationStage
)

if TYPE_CHECKING:
    from app.application.rag.retrieval_use_case import RetrievalUseCase
    from app.schemas.audio import AudioBuffer


class ConversationPipeline:
    """
    Manages the full conversation pipeline for one WebSocket session.
    """

    def __init__(
        self,
        asr: StreamingASRService | None = None,
        llm: BaseLLMProvider | None = None,
        tts: BaseTTSProvider | None = None,
        retrieval: RetrievalUseCase | None = None,
        avatar_id: str = "avatar1",
    ):
        self._asr = asr
        self._llm = llm
        self._tts = tts
        self._retrieval = retrieval
        self.avatar_id = avatar_id
        self._history = build_conversation(avatar_id)
        
        # Stages setup
        self.asr_stage = ASRStage()
        self.llm_stage = LLMStage(llm=self._llm, retrieval=self._retrieval)
        self.sentence_stage = SentenceSegmentationStage()
        self.tts_stage = TTSStage(tts=self._tts)
        self.animation_stage = AnimationStage(animation_service=AnimationIntelligenceService())

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
        from app.infrastructure.cache.chat_context_cache import push_message as push_ctx, get_or_rebuild_context
        from app.infrastructure.db.database import AsyncSessionLocal
        from app.infrastructure.db.repositories.chat_repository import ChatRepository

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
                await send_callback(make_error(code="EMPTY_INPUT", message="Empty text input", session_id=session_id, message_id=message_id))
                return

            # Input Persistence
            try:
                async with AsyncSessionLocal() as db:
                    repo = ChatRepository(db)
                    await repo.save_message(session_id=session_id, role="user", content=text, input_type="text")
                    await db.commit()
            except Exception as e:
                logger.warning(f"[Pipeline] Failed to persist user message: {e} | trace_id={trace_id}")

            await send_callback(make_user_message_echo(session_id=session_id, message_id=message_id, text=text, conversation_id=session_id))
            await push_ctx(session_id, "user", text)

            if self._history.is_empty:
                ctx_messages = await get_or_rebuild_context(session_id)
                for msg in ctx_messages[:-1]:
                    if msg["role"] == "user":
                        self._history.add_user_message(msg["content"])
                    elif msg["role"] == "assistant":
                        self._history.add_assistant_message(msg["content"])

            self._history.add_user_message(text)
            await send_callback(make_pipeline_state(session_id, "thinking"))

            # Execute pipeline stages sequentially
            stages = [
                self.llm_stage,
                self.sentence_stage,
                self.tts_stage,
                self.animation_stage
            ]

            for stage in stages:
                if context.aborted:
                    break
                await stage.process(context)

            # Output Persistence
            if context.llm_full_response and not context.aborted:
                tts_key: str | None = None
                try:
                    from app.infrastructure.cache.cache_keys import tts_cache_key as _tts_key
                    from app.shared.config import get_settings as _settings
                    tts_key = _tts_key(context.llm_full_response, _settings().TTS_VOICE)
                    async with AsyncSessionLocal() as db:
                        repo = ChatRepository(db)
                        await repo.save_message(
                            session_id=session_id, role="assistant", content=context.llm_full_response,
                            input_type="text", tts_cache_key=tts_key
                        )
                        await db.commit()
                except Exception as e:
                    logger.warning(f"[Pipeline] Failed to persist assistant message: {e} | trace_id={trace_id}")

                await push_ctx(
                    session_id, "assistant", context.llm_full_response,
                    extra={"tts_cache_key": tts_key} if tts_key else None,
                )

        except asyncio.CancelledError:
            context.abort()
            logger.info(f"Pipeline cancelled | session={session_id} | message={message_id} | trace_id={trace_id}")
            return
        except Exception as e:
            logger.error(f"Pipeline error: {e} | trace_id={trace_id}")
            await send_callback(make_error(code="PIPELINE_ERROR", message=str(e), session_id=session_id, message_id=message_id))
        finally:
            await send_callback(make_pipeline_state(session_id, "idle"))
            self._current_message_id = None
            self._current_context = None
            logger.info(f"Pipeline complete | session={session_id} | message={message_id} | trace_id={trace_id}")

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


