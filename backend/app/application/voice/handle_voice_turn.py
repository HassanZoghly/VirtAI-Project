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

from app.application.animation.audio_analysis import analyze_tts_for_animation
from app.application.animation.intelligence_service import AnimationIntelligenceService
from app.domain.chat.entities import (
    ConversationHistory,
    PipelineEvent,
    PipelineEventType,
    ev,
)
from app.domain.chat.policies import build_conversation
from app.domain.chat.ports import BaseLLMProvider
from app.domain.voice.ports import BaseTTSProvider, StreamingASRService
from app.infrastructure.asr.audio_pipeline import pcm_bytes_to_float32
from app.shared.config import get_settings
from app.shared.errors import ASRException, LLMException, TTSException

if TYPE_CHECKING:
    from app.application.rag.retrieval_use_case import RetrievalUseCase
    from app.schemas.audio import AudioBuffer

_EMOTION_RE = re.compile(r"^\[emotion:(\w+)]\s*")
_VALID_EMOTIONS = {
    "neutral",
    "happy",
    "sad",
    "surprised",
    "angry",
    "thinking",
    "confused",
    "empathetic",
    "excited",
    "concerned",
    "reassuring",
    "proud",
    "disappointed",
    "sarcastic",
    "grateful",
    "curious",
}
_LLM_DONE_SENTINEL = None


# ── TTS sentence processor ───────────────────────────────────────────────────


class TTSProcessor:
    """Processes a single sentence through TTS, emitting viseme + audio events."""

    def __init__(
        self,
        tts: BaseTTSProvider,
        event_queue: asyncio.Queue,
        sentence_index: int,
        session_id: str | None = None,
    ):
        self.tts = tts
        self.event_queue = event_queue
        self.sentence_index = sentence_index
        self.session_id = session_id
        self.viseme_events: list[dict] = []
        self.audio_chunks: list[str] = []
        self.chunk_index = 0

    async def process(self, sentence: str) -> None:
        async for tts_chunk in self.tts.synthesize_streaming(sentence):
            if tts_chunk.viseme is not None:
                self.viseme_events.append(
                    {
                        "offset_ms": tts_chunk.viseme.offset_ms,
                        "viseme_id": tts_chunk.viseme.viseme_id,
                        "duration_ms": tts_chunk.viseme.duration_ms,
                    }
                )
            elif tts_chunk.audio_data is not None:
                b64_audio = base64.b64encode(tts_chunk.audio_data).decode("utf-8")
                self.audio_chunks.append(b64_audio)
                if self.chunk_index == 0:
                    await self.event_queue.put(
                        ev(
                            PipelineEventType.TTS_VISEMES,
                            session_id=self.session_id,
                            sentence_index=self.sentence_index,
                            events=list(self.viseme_events),
                            audio_duration_ms=self._estimate_duration(),
                        )
                    )
                    self.viseme_events.clear()
                await self.event_queue.put(
                    ev(
                        PipelineEventType.TTS_AUDIO,
                        session_id=self.session_id,
                        audio=b64_audio,
                        chunk_index=self.chunk_index,
                        sentence_index=self.sentence_index,
                    )
                )
                self.chunk_index += 1
            elif tts_chunk.is_done:
                if self.viseme_events:
                    await self.event_queue.put(
                        ev(
                            PipelineEventType.TTS_VISEMES,
                            session_id=self.session_id,
                            sentence_index=self.sentence_index,
                            events=list(self.viseme_events),
                            audio_duration_ms=0.0,
                        )
                    )
                    self.viseme_events.clear()
                break

    def _estimate_duration(self) -> float:
        total_bytes = sum(len(base64.b64decode(c)) for c in self.audio_chunks)
        return (total_bytes / 3000.0) * 1000


# ── Main pipeline ─────────────────────────────────────────────────────────────


class ConversationPipeline:
    """
    Manages the full conversation pipeline for one WebSocket session.

    All adapter dependencies are injected as domain port interfaces.
    No concrete infrastructure is referenced — that wiring happens
    at the composition root (main.py / dependencies.py).
    """

    def __init__(
        self,
        asr: StreamingASRService | None = None,
        llm: BaseLLMProvider | None = None,
        tts: BaseTTSProvider | None = None,
        retrieval: RetrievalUseCase | None = None,
        avatar_id: str = "avatar1",
        max_sentence_queue_size: int = 5,
    ):
        self._asr: StreamingASRService | None = asr
        self._llm: BaseLLMProvider | None = llm
        self._tts: BaseTTSProvider | None = tts
        self._retrieval = retrieval
        self.avatar_id = avatar_id
        self._history: ConversationHistory = build_conversation(avatar_id)
        self._aborted: bool = False
        self._current_llm_task: asyncio.Task | None = None
        self._current_tts_task: asyncio.Task | None = None
        self._current_message_id: str | None = None
        self._max_sentence_queue_size = max_sentence_queue_size
        self._animation_service = AnimationIntelligenceService()
        self._recent_animation_assets: list[str] = []
        self._profile_usage: dict[str, int] = defaultdict(int)
        self._intent_history: list[str] = []
        logger.info(f"ConversationPipeline created | avatar={avatar_id}")

    # ── Public API ────────────────────────────────────────────────────────────

    async def process_audio(
        self,
        audio_buffer: AudioBuffer,
        session_id: str | None = None,
    ) -> AsyncGenerator[PipelineEvent, None]:
        """Full pipeline: Audio → ASR → LLM → TTS."""
        self._aborted = False
        async for event in self._run_pipeline(
            audio_buffer=audio_buffer,
            text_input=None,
            session_id=session_id,
        ):
            yield event

    async def process_text(
        self,
        text: str,
        session_id: str | None = None,
    ) -> AsyncGenerator[PipelineEvent, None]:
        """Shortcut pipeline: Text → LLM → TTS (skips ASR)."""
        self._aborted = False
        async for event in self._run_pipeline(
            audio_buffer=None,
            text_input=text,
            session_id=session_id,
        ):
            yield event

    async def process_message(
        self,
        message_id: str,
        text: str,
        session_id: str,
        send_callback: Callable,
        trace_id: str | None = None,
    ) -> None:
        """
        Process user message through LLM → TTS → Visemes pipeline.

        Flow:
          1. Persist user message to PostgreSQL via ChatRepository
          2. Push user message to Redis context
          3. Warm up in-memory history from Redis if empty (cache miss → rebuild from PostgreSQL)
          4. LLM streams tokens
          5. Persist assistant message to PostgreSQL + push to Redis context
          6. TTS generation
          7. Viseme generation
        """
        from app.infrastructure.cache.cache_keys import tts_cache_key as _tts_key
        from app.infrastructure.cache.chat_context_cache import (
            get_or_rebuild_context,
        )
        from app.infrastructure.cache.chat_context_cache import (
            push_message as push_ctx,
        )
        from app.infrastructure.db.database import AsyncSessionLocal
        from app.infrastructure.db.repositories.chat_repository import ChatRepository
        from app.infrastructure.tts.viseme_generator import VisemeGenerator
        from app.schemas.ws_messages import (
            make_animation_timeline_v2,
            make_chat_delta,
            make_chat_final,
            make_error,
            make_pipeline_state,
            make_tts_ready,
            make_user_message_echo,
            make_visemes_ready,
        )
        from app.shared.config import get_settings as _settings

        self._aborted = False
        self._current_message_id = message_id

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

            # ── 1. Persist user message ────────────────────────────────────────
            try:
                async with AsyncSessionLocal() as db:
                    repo = ChatRepository(db)
                    await repo.save_message(
                        session_id=session_id,
                        role="user",
                        content=text,
                        input_type="text",
                    )
                    await db.commit()
            except Exception as e:
                logger.warning(f"[Pipeline] Failed to persist user message: {e} | trace_id={trace_id}")

            await send_callback(
                make_user_message_echo(
                    session_id=session_id,
                    message_id=message_id,
                    text=text,
                    conversation_id=session_id,
                )
            )

            # ── 2. Push user message to Redis context ─────────────────────────
            await push_ctx(session_id, "user", text)

            # ── 3. Warm up in-memory history from Redis if empty ──────────────
            if self._history.is_empty:
                ctx_messages = await get_or_rebuild_context(session_id)
                for msg in ctx_messages[:-1]:  # skip the just-pushed user message
                    if msg["role"] == "user":
                        self._history.add_user_message(msg["content"])
                    elif msg["role"] == "assistant":
                        self._history.add_assistant_message(msg["content"])

            self._history.add_user_message(text)
            await send_callback(make_pipeline_state(session_id, "thinking"))

            if self._aborted:
                await send_callback(make_pipeline_state(session_id, "idle"))
                return

            # ── 3.5 RAG Context Injection ──────────────────────────────────────
            original_sys_prompt = self._history.system_prompt
            if self._retrieval:
                try:
                    context = await self._retrieval.execute(text)
                    if context:
                        self._history.system_prompt = f"{original_sys_prompt}\n\nUse the following retrieved context to answer the query:\n{context}"
                except Exception as e:
                    logger.error(f"RAG retrieval failed: {e} | trace_id={trace_id}")

            # ── 4. Stream LLM tokens ──────────────────────────────────────────
            full_response_parts: list[str] = []
            if not self._llm:
                self._history.system_prompt = original_sys_prompt
                raise LLMException("LLM service not configured")
            try:
                async for chunk in self._llm.stream(self._history, trace_id=trace_id):
                    if self._aborted:
                        break
                    if chunk.token:
                        full_response_parts.append(chunk.token)
                        await send_callback(
                            make_chat_delta(
                                session_id=session_id,
                                message_id=message_id,
                                delta=chunk.token,
                            )
                        )
                    if chunk.is_done:
                        break
            except LLMException as e:
                logger.error(f"LLM error: {e} | trace_id={trace_id}")
                await send_callback(
                    make_error(
                        code="LLM_ERROR",
                        message=str(e),
                        session_id=session_id,
                        message_id=message_id,
                    )
                )
                await send_callback(make_pipeline_state(session_id, "idle"))
                return
            finally:
                self._history.system_prompt = original_sys_prompt

            if self._aborted:
                await send_callback(make_pipeline_state(session_id, "idle"))
                return

            full_response = "".join(full_response_parts).strip()

            # Parse emotion tag
            emotion: str | None = None
            emotion_match = _EMOTION_RE.match(full_response)
            if emotion_match:
                detected = emotion_match.group(1).lower()
                if detected in _VALID_EMOTIONS:
                    emotion = detected
                full_response = _EMOTION_RE.sub("", full_response).strip()

            if not full_response:
                await send_callback(
                    make_error(
                        code="EMPTY_RESPONSE",
                        message="LLM returned empty response",
                        session_id=session_id,
                        message_id=message_id,
                    )
                )
                await send_callback(make_pipeline_state(session_id, "idle"))
                return

            await send_callback(
                make_chat_final(
                    session_id=session_id,
                    message_id=message_id,
                    text=full_response,
                    emotion=emotion,
                )
            )

            self._history.add_assistant_message(full_response)

            # ── 5. Persist assistant message + update Redis context ────────────
            tts_key: str | None = None
            try:
                tts_key = _tts_key(full_response, _settings().TTS_VOICE)
                async with AsyncSessionLocal() as db:
                    repo = ChatRepository(db)
                    await repo.save_message(
                        session_id=session_id,
                        role="assistant",
                        content=full_response,
                        input_type="text",
                        tts_cache_key=tts_key,
                    )
                    await db.commit()
            except Exception as e:
                logger.warning(f"[Pipeline] Failed to persist assistant message: {e} | trace_id={trace_id}")

            await push_ctx(
                session_id,
                "assistant",
                full_response,
                extra={"tts_cache_key": tts_key} if tts_key else None,
            )

            if self._aborted:
                await send_callback(make_pipeline_state(session_id, "idle"))
                return

            # ── 6. TTS ────────────────────────────────────────────────────────
            await send_callback(make_pipeline_state(session_id, "speaking"))
            if not self._tts:
                raise TTSException("TTS service not configured")
            try:
                tts_result = await self._tts.generate(
                    text=full_response,
                    session_id=session_id,
                    message_id=message_id,
                    trace_id=trace_id,
                )
            except TTSException as e:
                logger.error(f"TTS error: {e} | trace_id={trace_id}")
                # Graceful degradation: log the error but don't return early
                # We will send text and a dummy timeline to prevent pipeline crash
                await send_callback(
                    make_error(
                        code="TTS_ERROR",
                        message=str(e),
                        session_id=session_id,
                        message_id=message_id,
                    )
                )
                tts_result = None

            if self._aborted:
                await send_callback(make_pipeline_state(session_id, "idle"))
                return

            # ── 7. Visemes ────────────────────────────────────────────────────
            viseme_generator = VisemeGenerator()
            if tts_result and getattr(tts_result, "audio_ref", None):
                mouth_cues = await viseme_generator.generate_from_audio(
                    audio_path=tts_result.audio_ref,
                    text=full_response,
                    session_id=session_id,
                    message_id=message_id,
                )
            else:
                mouth_cues = []

            if self._aborted:
                await send_callback(make_pipeline_state(session_id, "idle"))
                return

            # ── 8. Audio-driven animation timeline v2 ────────────────────────
            from app.domain.voice.entities import TTSResult
            
            safe_tts_result = tts_result or TTSResult(
                audio_bytes=b"",
                visemes=[],
                word_boundaries=[],
                audio_duration_ms=len(full_response) * 60.0  # Estimate 60ms per char
            )

            audio_features = analyze_tts_for_animation(
                tts_result=safe_tts_result,
                mouth_cues=mouth_cues,
                text=full_response,
            )

            timeline_payload = self._animation_service.build_timeline_v2(
                text=full_response,
                audio_features=audio_features,
                recent_assets=self._recent_animation_assets,
                emotion=emotion,
                profile_usage=self._profile_usage,
                intent_history=self._intent_history,
            )

            audio_url = f"/api/v1/audio/{session_id}/{message_id}.mp3" if tts_result else ""
            duration = int(tts_result.audio_duration_ms) if tts_result else 0
            
            if audio_url:
                await send_callback(
                    make_tts_ready(
                        session_id=session_id,
                        message_id=message_id,
                        audio_url=audio_url,
                        duration_ms=duration,
                    )
                )
            await send_callback(
                make_visemes_ready(
                    session_id=session_id,
                    message_id=message_id,
                    mouth_cues=mouth_cues,
                )
            )

            if timeline_payload["timeline"]:
                await send_callback(
                    make_animation_timeline_v2(
                        session_id=session_id,
                        message_id=message_id,
                        timeline=timeline_payload["timeline"],
                        meta=timeline_payload.get("meta", {}),
                    )
                )
                self._recent_animation_assets.extend(
                    item["animation_asset"]
                    for item in timeline_payload["timeline"]
                    if item.get("animation_asset") and item["animation_asset"] != "Idle"
                )
                self._recent_animation_assets = self._recent_animation_assets[-12:]

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
            logger.info(f"Pipeline complete | session={session_id} | message={message_id} | trace_id={trace_id}")

    def abort(self) -> None:
        """Signal the pipeline to stop and cancel running tasks."""
        self._aborted = True
        if self._current_llm_task and not self._current_llm_task.done():
            self._current_llm_task.cancel()
        if self._current_tts_task and not self._current_tts_task.done():
            self._current_tts_task.cancel()
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

    # ── Private orchestration ─────────────────────────────────────────────────

    async def _run_pipeline(
        self,
        audio_buffer: AudioBuffer | None,
        text_input: str | None,
        session_id: str | None = None,
    ) -> AsyncGenerator[PipelineEvent, None]:
        start = time.perf_counter()
        user_text: str | None = None

        # ASR step
        if audio_buffer is not None:
            yield ev(PipelineEventType.PROCESSING, session_id=session_id)
            try:
                user_text = await self._run_asr(audio_buffer)
                yield ev(PipelineEventType.TRANSCRIPT, session_id=session_id, text=user_text)
            except ASRException as e:
                logger.error(f"ASR failed: {e}")
                yield ev(
                    PipelineEventType.ERROR, session_id=session_id, code="ASR_ERROR", message=str(e)
                )
                yield ev(PipelineEventType.IDLE, session_id=session_id)
                return

        if text_input is not None:
            user_text = text_input.strip()

        if not user_text:
            yield ev(
                PipelineEventType.ERROR,
                session_id=session_id,
                code="EMPTY_INPUT",
                message="No input",
            )
            yield ev(PipelineEventType.IDLE, session_id=session_id)
            return

        history_was_empty = self._history.is_empty

        # Persist/warm cache for legacy protocol flows as well.
        if session_id:
            # Save user message to PostgreSQL
            try:
                from app.infrastructure.db.database import AsyncSessionLocal
                from app.infrastructure.db.repositories.chat_repository import ChatRepository

                async with AsyncSessionLocal() as db:
                    repo = ChatRepository(db)
                    await repo.save_message(
                        session_id=session_id,
                        role="user",
                        content=user_text,
                        input_type="text",
                    )
                    await db.commit()
            except Exception as e:
                logger.warning(f"[Pipeline] Failed to persist user message: {e}")

            # Update Redis context
            try:
                from app.infrastructure.cache.chat_context_cache import (
                    get_or_rebuild_context,
                )
                from app.infrastructure.cache.chat_context_cache import (
                    push_message as push_ctx,
                )

                await push_ctx(session_id, "user", user_text)

                if history_was_empty:
                    ctx_messages = await get_or_rebuild_context(session_id)
                    for msg in ctx_messages[:-1]:
                        if msg["role"] == "user":
                            self._history.add_user_message(msg["content"])
                        elif msg["role"] == "assistant":
                            self._history.add_assistant_message(msg["content"])
            except Exception as e:
                logger.warning(f"[Pipeline] Failed to update Redis user context: {e}")

        self._history.add_user_message(user_text)
        yield ev(PipelineEventType.THINKING, session_id=session_id)

        # ── 3.5 RAG Context Injection ──────────────────────────────────────
        original_sys_prompt = self._history.system_prompt
        if self._retrieval:
            try:
                context = await self._retrieval.execute(user_text)
                if context:
                    self._history.system_prompt = f"{original_sys_prompt}\n\nUse the following retrieved context to answer the query:\n{context}"
            except Exception as e:
                logger.error(f"RAG retrieval failed: {e}")

        # Concurrent LLM + TTS
        sentence_queue: asyncio.Queue[str | None] = asyncio.Queue(
            maxsize=self._max_sentence_queue_size,
        )
        event_queue: asyncio.Queue[PipelineEvent] = asyncio.Queue()
        collected_events: list[PipelineEvent] = []

        try:
            self._current_llm_task = asyncio.create_task(
                self._llm_worker(sentence_queue, event_queue, session_id),
            )
            self._current_tts_task = asyncio.create_task(
                self._tts_worker(sentence_queue, event_queue, session_id),
            )
            await asyncio.gather(self._current_llm_task, self._current_tts_task)
        except asyncio.CancelledError:
            for t in (self._current_llm_task, self._current_tts_task):
                if t and not t.done():
                    t.cancel()
            yield ev(PipelineEventType.ABORT, session_id=session_id)
            yield ev(PipelineEventType.IDLE, session_id=session_id)
            return
        except Exception as e:
            logger.error(f"Pipeline error: {e}")
            yield ev(
                PipelineEventType.ERROR,
                session_id=session_id,
                code="PIPELINE_ERROR",
                message=str(e),
            )
            yield ev(PipelineEventType.IDLE, session_id=session_id)
            return
        finally:
            self._history.system_prompt = original_sys_prompt

        # Drain event queue
        while not event_queue.empty():
            evt = event_queue.get_nowait()
            evt.session_id = session_id
            collected_events.append(evt)

        for evt in collected_events:
            yield evt

        # Save assistant response
        full_response = "".join(
            e.data.get("token", "")
            for e in collected_events
            if e.type == PipelineEventType.LLM_TOKEN
        )
        assistant_text = full_response.strip()
        if assistant_text:
            self._history.add_assistant_message(assistant_text)

            if session_id:
                tts_key: str | None = None
                try:
                    from app.infrastructure.cache.cache_keys import tts_cache_key as _tts_key
                    from app.infrastructure.db.database import AsyncSessionLocal
                    from app.infrastructure.db.repositories.chat_repository import ChatRepository
                    from app.shared.config import get_settings as _settings

                    tts_key = _tts_key(assistant_text, _settings().TTS_VOICE)
                    async with AsyncSessionLocal() as db:
                        repo = ChatRepository(db)
                        await repo.save_message(
                            session_id=session_id,
                            role="assistant",
                            content=assistant_text,
                            input_type="text",
                            tts_cache_key=tts_key,
                        )
                        await db.commit()
                except Exception as e:
                    logger.warning(f"[Pipeline] Failed to persist assistant message: {e}")

                try:
                    from app.infrastructure.cache.chat_context_cache import push_message as push_ctx

                    await push_ctx(
                        session_id,
                        "assistant",
                        assistant_text,
                        extra={"tts_cache_key": tts_key} if tts_key else None,
                    )
                except Exception as e:
                    logger.warning(f"[Pipeline] Failed to update Redis assistant context: {e}")

        elapsed = time.perf_counter() - start
        logger.info(f"Pipeline done | {elapsed:.2f}s | session={session_id}")
        yield ev(PipelineEventType.IDLE, session_id=session_id)

    async def _run_asr(self, audio_buffer: AudioBuffer) -> str:
        logger.info(
            f"ASR start | chunks={len(audio_buffer.chunks)} | size={audio_buffer.total_size}"
        )
        if not self._asr:
            raise ASRException("ASR service not configured")
        settings = get_settings()
        combined = b"".join(audio_buffer.chunks)
        audio_data = pcm_bytes_to_float32(combined)
        result = await self._asr.transcribe_stream(
            audio_data=audio_data,
            sample_rate=settings.AUDIO_SAMPLE_RATE,
        )
        logger.info(f"ASR result | text='{result.transcript[:60]}'")
        return result.transcript

    async def _llm_worker(
        self,
        sentence_queue: asyncio.Queue,
        event_queue: asyncio.Queue,
        session_id: str | None = None,
    ) -> None:
        logger.info(f"LLM worker started | session={session_id}")
        if not self._llm:
            await event_queue.put(
                ev(
                    PipelineEventType.ERROR,
                    session_id=session_id,
                    code="LLM_ERROR",
                    message="LLM service not configured",
                )
            )
            return
        try:
            async for chunk in self._llm.stream(self._history):
                if self._aborted:
                    break
                if chunk.token:
                    await event_queue.put(
                        ev(PipelineEventType.LLM_TOKEN, session_id=session_id, token=chunk.token)
                    )
                if chunk.sentence:
                    clean = _clean_text_for_tts(chunk.sentence)
                    if clean:
                        await sentence_queue.put(clean)
                if chunk.is_done:
                    break
        except LLMException as e:
            await event_queue.put(
                ev(PipelineEventType.ERROR, session_id=session_id, code="LLM_ERROR", message=str(e))
            )
        except asyncio.CancelledError:
            logger.info(f"LLM worker cancelled | session={session_id}")
            raise
        finally:
            try:
                await sentence_queue.put(_LLM_DONE_SENTINEL)
            except asyncio.CancelledError:
                pass
            await event_queue.put(ev(PipelineEventType.LLM_DONE, session_id=session_id))

    async def _tts_worker(
        self,
        sentence_queue: asyncio.Queue,
        event_queue: asyncio.Queue,
        session_id: str | None = None,
    ) -> None:
        logger.info(f"TTS worker started | session={session_id}")
        sentence_index = 0
        try:
            while True:
                if self._aborted:
                    break
                sentence = await sentence_queue.get()
                if sentence is _LLM_DONE_SENTINEL:
                    break
                sentence_index += 1
                await event_queue.put(ev(PipelineEventType.SPEAKING, session_id=session_id))
                if not self._tts:
                    await event_queue.put(
                        ev(
                            PipelineEventType.ERROR,
                            session_id=session_id,
                            code="TTS_ERROR",
                            message="TTS service not configured",
                        )
                    )
                    break
                try:
                    processor = TTSProcessor(
                        self._tts, event_queue, sentence_index, session_id=session_id
                    )
                    await processor.process(sentence)
                except TTSException as e:
                    logger.error(f"TTS error on sentence {sentence_index}: {e}")
                    await event_queue.put(
                        ev(
                            PipelineEventType.ERROR,
                            session_id=session_id,
                            code="TTS_ERROR",
                            message=str(e),
                            sentence_index=sentence_index,
                        )
                    )
                    continue
                except asyncio.CancelledError:
                    raise
        except asyncio.CancelledError:
            logger.info(f"TTS worker cancelled | session={session_id}")
            raise
        finally:
            await event_queue.put(ev(PipelineEventType.TTS_DONE, session_id=session_id))


# ── Private helpers ───────────────────────────────────────────────────────────


def _clean_text_for_tts(text: str) -> str:
    """Minimal TTS text cleanup (no infrastructure dependency)."""

    text = re.sub(r"\*{1,3}(.+?)\*{1,3}", r"\1", text)
    text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)
    text = re.sub(r"http[s]?://\S+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text
