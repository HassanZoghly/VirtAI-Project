"""
ConversationPipeline

The main orchestrator that connects:
    ASR → LLM → TTS

Architecture:
    - Uses asyncio.Queue to buffer sentences between LLM and TTS
    - LLM and TTS run concurrently via asyncio.gather
    - Events are yielded to the WebSocket handler in real-time
"""

from __future__ import annotations

import asyncio
import re
import time
from collections.abc import AsyncGenerator
from typing import Optional

from loguru import logger

from app.shared.errors import ASRException, LLMException, TTSException
from app.schemas.audio import AudioBuffer
from app.infrastructure.asr.groq_whisper import GroqWhisperASR
from app.domain.chat.entities import ConversationHistory, PipelineEvent, PipelineEventType, ev
from app.infrastructure.llm.groq_provider import GroqLLMProvider
from app.domain.chat.policies import build_conversation
from app.infrastructure.tts.edge_tts_provider import EdgeTTSProvider
from app.infrastructure.tts.tts_utils import audio_to_base64, clean_text_for_tts

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

# Sentinel to signal the TTS worker that LLM is done
_LLM_DONE_SENTINEL = None


class TTSProcessor:
    """
    Handles TTS processing for a single sentence, including:
    - Converting sentence to visemes and audio chunks
    - Emitting events
    """

    def __init__(self, tts: EdgeTTSProvider, event_queue: asyncio.Queue, sentence_index: int):
        self.tts = tts
        self.event_queue = event_queue
        self.sentence_index = sentence_index
        self.viseme_events: list[dict] = []
        self.audio_chunks: list[str] = []
        self.chunk_index = 0

    async def process(self, sentence: str) -> None:
        """Process a single sentence and emit events."""
        async for tts_chunk in self.tts.synthesize_streaming(sentence):
            # Viseme event
            if tts_chunk.viseme is not None:
                self.viseme_events.append(
                    {
                        "offset_ms": tts_chunk.viseme.offset_ms,
                        "viseme_id": tts_chunk.viseme.viseme_id,
                        "duration_ms": tts_chunk.viseme.duration_ms,
                    }
                )

            # Audio chunk
            elif tts_chunk.audio_data is not None:
                b64_audio = audio_to_base64(tts_chunk.audio_data)
                self.audio_chunks.append(b64_audio)

                # First audio chunk → send visemes first
                if self.chunk_index == 0 and self.viseme_events:
                    await self.event_queue.put(
                        ev(
                            PipelineEventType.TTS_VISEMES,
                            sentence_index=self.sentence_index,
                            events=self.viseme_events,
                            audio_duration_ms=self._estimate_duration(),
                        )
                    )

                # Send audio chunk
                await self.event_queue.put(
                    ev(
                        PipelineEventType.TTS_AUDIO,
                        audio=b64_audio,
                        chunk_index=self.chunk_index,
                        sentence_index=self.sentence_index,
                    )
                )
                self.chunk_index += 1

            # Done
            elif tts_chunk.is_done:
                # Send visemes if we haven't yet (edge case: no audio chunks)
                if self.viseme_events and self.chunk_index == 0:
                    await self.event_queue.put(
                        ev(
                            PipelineEventType.TTS_VISEMES,
                            sentence_index=self.sentence_index,
                            events=self.viseme_events,
                            audio_duration_ms=0.0,
                        )
                    )
                break

        logger.debug(
            f"Sentence {self.sentence_index} TTS done | "
            f"visemes={len(self.viseme_events)} | "
            f"audio_chunks={self.chunk_index}"
        )

    def _estimate_duration(self) -> float:
        """Rough estimate of audio duration from base64 chunks."""
        import base64

        total_bytes = sum(len(base64.b64decode(c)) for c in self.audio_chunks)
        # MP3 @ ~24kbps → 3000 bytes/sec
        return (total_bytes / 3000.0) * 1000  # milliseconds


class ConversationPipeline:
    """
    Manages the full conversation pipeline for one WebSocket session.
    Lifecycle:
        1. Created once per WebSocket connection
        2. process_audio() called when user finishes speaking
        3. process_text()  called when user sends text directly
        4. Yields PipelineEvents to the WebSocket handler
        5. Conversation history is preserved across turns
    """

    def __init__(
        self,
        avatar_id: str = "avatar1",
        asr: GroqWhisperASR | None = None,
        llm: GroqLLMProvider | None = None,
        tts: EdgeTTSProvider | None = None,
        max_sentence_queue_size: int = 5,
    ):
        """
        Initialize ConversationPipeline with services.

        Services can be injected for dependency injection and testing.
        If not provided, default instances will be created.

        Args:
            avatar_id: Avatar identifier for this pipeline
            asr: ASR service instance (optional, creates default if None)
            llm: LLM service instance (optional, creates default if None)
            tts: TTS service instance (optional, creates default if None)
            max_sentence_queue_size: Maximum size of sentence queue for LLM->TTS
        """
        # Services
        self._asr = asr or GroqWhisperASR()
        self._llm = llm or GroqLLMProvider()
        self._tts = tts or EdgeTTSProvider()

        # Conversation state
        self.avatar_id: str = avatar_id
        self._history: ConversationHistory = build_conversation(avatar_id)

        # Pipeline control
        self._aborted: bool = False
        self._current_llm_task: Optional[asyncio.Task] = None
        self._current_tts_task: Optional[asyncio.Task] = None
        self._current_message_id: Optional[str] = None
        self._max_sentence_queue_size = max_sentence_queue_size

        logger.info(f"ConversationPipeline created | " f"avatar={avatar_id}")

    # ── Public API ────────────────────────────────────────────────────────────
    async def process_audio(
        self,
        audio_buffer: AudioBuffer,
        session_id: Optional[str] = None,
    ) -> AsyncGenerator[PipelineEvent, None]:
        """
        Full pipeline: Audio → ASR → LLM → TTS
        Args:
            audio_buffer: accumulated audio chunks from WebSocket
            session_id: optional for tracking
        """
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
        session_id: Optional[str] = None,
    ) -> AsyncGenerator[PipelineEvent, None]:
        """
        Shortcut pipeline: Text → LLM → TTS (skips ASR)
        Args:
            text: direct text input from user
            session_id: optional for tracking
        """
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
        send_callback: callable,
    ) -> None:
        """
        Process user message through LLM → TTS → Visemes pipeline.

        This method orchestrates the complete conversation flow:
        1. Emit thinking state
        2. Stream LLM tokens via chat.delta messages
        3. Emit final response via chat.final
        4. Emit speaking state
        5. Generate TTS audio
        6. Generate viseme timeline
        7. Emit tts.ready and visemes.ready
        8. Return to idle state

        Args:
            message_id: Unique message identifier (UUID)
            text: User message text
            session_id: Session identifier (UUID)
            send_callback: Async callback to send messages to client
                          Signature: async def send(message: BaseModel) -> None

        Preconditions:
        - message_id is unique for this session
        - text is non-empty
        - send_callback is valid async function
        - session_id is valid

        Postconditions:
        - Pipeline returns to idle state
        - All generated files are stored
        - Client receives all messages in order

        Cancellation:
        - Respects self._aborted flag
        - Cancels LLM and TTS tasks cleanly
        - Returns to idle state on cancellation
        """
        from app.schemas.ws_messages import (
            make_chat_delta,
            make_chat_final,
            make_error,
            make_pipeline_state,
            make_tts_ready,
            make_visemes_ready,
        )
        from app.services.tts.viseme_generator import VisemeGenerator

        self._aborted = False
        self._current_message_id = message_id

        try:
            # Validate input
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

            # Add user message to history
            self._history.add_user_message(text)

            # Emit thinking state
            await send_callback(make_pipeline_state(session_id, "thinking"))

            if self._aborted:
                await send_callback(make_pipeline_state(session_id, "idle"))
                return

            # Stream LLM tokens
            full_response_parts: list[str] = []

            try:
                async for chunk in self._llm.stream(self._history):
                    if self._aborted:
                        break

                    # Token → send chat.delta
                    if chunk.token:
                        full_response_parts.append(chunk.token)
                        await send_callback(
                            make_chat_delta(
                                session_id=session_id, message_id=message_id, delta=chunk.token
                            )
                        )

                    # Stream done
                    if chunk.is_done:
                        break

            except LLMException as e:
                logger.error(f"LLM error: {e}")
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

            if self._aborted:
                await send_callback(make_pipeline_state(session_id, "idle"))
                return

            # Build full response
            full_response = "".join(full_response_parts).strip()

            # Parse emotion tag from LLM response
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

            # Emit final response
            await send_callback(
                make_chat_final(
                    session_id=session_id,
                    message_id=message_id,
                    text=full_response,
                    emotion=emotion,
                )
            )

            # Save assistant response to history
            self._history.add_assistant_message(full_response)

            if self._aborted:
                await send_callback(make_pipeline_state(session_id, "idle"))
                return

            # Emit speaking state
            await send_callback(make_pipeline_state(session_id, "speaking"))

            # Generate TTS audio
            try:
                tts_result = await self._tts.generate(
                    text=full_response, session_id=session_id, message_id=message_id
                )
            except TTSException as e:
                logger.error(f"TTS error: {e}")
                await send_callback(
                    make_error(
                        code="TTS_ERROR",
                        message=str(e),
                        session_id=session_id,
                        message_id=message_id,
                    )
                )
                await send_callback(make_pipeline_state(session_id, "idle"))
                return

            if self._aborted:
                await send_callback(make_pipeline_state(session_id, "idle"))
                return

            # Generate viseme timeline
            viseme_generator = VisemeGenerator()
            mouth_cues = await viseme_generator.generate_from_audio(
                audio_path=tts_result.file_path,
                text=full_response,
                session_id=session_id,
                message_id=message_id,
            )

            if self._aborted:
                await send_callback(make_pipeline_state(session_id, "idle"))
                return

            # Emit TTS ready
            audio_url = f"/api/v1/audio/{session_id}/{message_id}.mp3"
            await send_callback(
                make_tts_ready(
                    session_id=session_id,
                    message_id=message_id,
                    audio_url=audio_url,
                    duration_ms=int(tts_result.audio_duration_ms),
                )
            )

            # Emit visemes ready
            await send_callback(
                make_visemes_ready(
                    session_id=session_id, message_id=message_id, mouth_cues=mouth_cues
                )
            )

        except Exception as e:
            logger.error(f"Pipeline error: {e}")
            await send_callback(
                make_error(
                    code="PIPELINE_ERROR",
                    message=str(e),
                    session_id=session_id,
                    message_id=message_id,
                )
            )

        finally:
            # Always return to idle
            await send_callback(make_pipeline_state(session_id, "idle"))
            self._current_message_id = None

            logger.info(f"Pipeline complete | " f"session={session_id} | " f"message={message_id}")

    def abort(self) -> None:
        """
        Signals the pipeline to stop and cancels any running async tasks.

        This method:
        1. Sets the abort flag to stop new operations
        2. Cancels the LLM worker task if running
        3. Cancels the TTS worker task if running

        The tasks will handle CancelledError gracefully and clean up.
        """
        self._aborted = True

        # Cancel running tasks
        if self._current_llm_task and not self._current_llm_task.done():
            self._current_llm_task.cancel()
            logger.debug("LLM task cancelled via abort()")

        if self._current_tts_task and not self._current_tts_task.done():
            self._current_tts_task.cancel()
            logger.debug("TTS task cancelled via abort()")

        logger.info("Pipeline abort requested")

    def reset_history(self) -> None:
        """Clears conversation history (new session)."""
        self._history.clear()
        logger.info("Conversation history cleared")

    def change_avatar(self, avatar_id: str) -> None:
        """Changes avatar and resets history with new system prompt."""
        self._history = build_conversation(avatar_id)
        self.avatar_id = avatar_id
        logger.info(f"Avatar changed to: {avatar_id}")

    @property
    def history_length(self) -> int:
        return self._history.message_count

    # ── Private: Main Pipeline ────────────────────────────────────────────────
    async def _run_pipeline(
        self,
        audio_buffer: AudioBuffer | None,
        text_input: str | None,
        session_id: Optional[str] = None,
    ) -> AsyncGenerator[PipelineEvent, None]:
        """
        Main pipeline runner.
        Steps:
            1. ASR (if audio_buffer provided)
            2. LLM streaming → sentence queue
            3. TTS concurrent with LLM
        """
        start_time = time.perf_counter()

        # Step 1: ASR
        if audio_buffer is not None:
            yield self._ev(PipelineEventType.PROCESSING, session_id=session_id)
            try:
                transcript = await self._run_asr(audio_buffer)
            except ASRException as e:
                yield self._ev(
                    PipelineEventType.ERROR, session_id=session_id, code="ASR_ERROR", message=str(e)
                )
                yield self._ev(PipelineEventType.IDLE, session_id=session_id)
                return
            yield self._ev(PipelineEventType.TRANSCRIPT, session_id=session_id, text=transcript)
            user_text = transcript
        elif text_input is not None:
            user_text = text_input.strip()
            if not user_text:
                yield self._ev(
                    PipelineEventType.ERROR,
                    session_id=session_id,
                    code="EMPTY_INPUT",
                    message="Empty text input",
                )
                return
        else:
            yield self._ev(
                PipelineEventType.ERROR,
                session_id=session_id,
                code="NO_INPUT",
                message="No audio or text input provided",
            )
            return

        # Check abort
        if self._aborted:
            yield self._ev(PipelineEventType.ABORT, session_id=session_id)
            return

        # Add user message to history
        self._history.add_user_message(user_text)

        # Step 2+3: LLM + TTS concurrent
        yield self._ev(PipelineEventType.THINKING, session_id=session_id)

        # Queue to pass sentences from LLM worker → TTS worker
        sentence_queue: asyncio.Queue[Optional[str]] = asyncio.Queue(
            maxsize=self._max_sentence_queue_size
        )

        # Shared event queue to collect events from workers
        event_queue: asyncio.Queue[PipelineEvent] = asyncio.Queue()

        # Create tasks
        llm_task = asyncio.create_task(
            self._llm_worker(sentence_queue, event_queue, session_id), name=f"llm-{session_id}"
        )
        tts_task = asyncio.create_task(
            self._tts_worker(sentence_queue, event_queue, session_id), name=f"tts-{session_id}"
        )

        # Track tasks for cancellation
        self._current_llm_task = llm_task
        self._current_tts_task = tts_task

        # Wait for both workers, with proper exception handling
        try:
            await asyncio.gather(llm_task, tts_task)
        except asyncio.CancelledError:
            logger.info(f"Pipeline cancelled for session {session_id}")
            # Cancel both tasks if not already
            llm_task.cancel()
            tts_task.cancel()
            await asyncio.gather(llm_task, tts_task, return_exceptions=True)
            yield self._ev(PipelineEventType.ABORT, session_id=session_id)
            return
        except Exception as e:
            logger.error(f"Pipeline concurrent execution failed for session {session_id}: {e}")
            yield self._ev(
                PipelineEventType.ERROR,
                session_id=session_id,
                code="PIPELINE_ERROR",
                message=str(e),
            )
            yield self._ev(PipelineEventType.IDLE, session_id=session_id)
            return
        finally:
            # Clear task references
            self._current_llm_task = None
            self._current_tts_task = None

        # Drain event queue
        full_response_parts: list[str] = []
        while not event_queue.empty():
            event = event_queue.get_nowait()
            event.session_id = session_id
            yield event

            # Collect LLM tokens to build full response
            if event.type == PipelineEventType.LLM_TOKEN:
                full_response_parts.append(event.data.get("token", ""))

        # Save assistant response to history
        full_response = "".join(full_response_parts).strip()
        if full_response:
            self._history.add_assistant_message(full_response)

        # Done
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.success(f"Pipeline complete for session {session_id} | elapsed={elapsed_ms:.0f}ms")
        yield self._ev(PipelineEventType.IDLE, session_id=session_id)

    # ── Private: ASR Worker ───────────────────────────────────────────────────
    async def _run_asr(self, audio_buffer: AudioBuffer) -> str:
        """Runs ASR and returns the transcript."""
        logger.info(
            f"ASR start | "
            f"chunks={audio_buffer.chunk_count} | "
            f"size={audio_buffer.total_size:,}B"
        )

        result = await self._asr.transcribe_chunks(
            audio_chunks=audio_buffer.chunks,
        )

        logger.info(f"ASR result: '{result.transcript}'")
        return result.transcript

    # ── Private: LLM Worker ───────────────────────────────────────────────────
    async def _llm_worker(
        self,
        sentence_queue: asyncio.Queue[Optional[str]],
        event_queue: asyncio.Queue[PipelineEvent],
        session_id: Optional[str] = None,
    ) -> None:
        """
        Streams LLM output.
        - Puts every token into event_queue (for frontend typing effect)
        - Puts complete sentences into sentence_queue (for TTS worker)
        """
        logger.info(f"LLM worker started for session {session_id}")
        full_text_parts: list[str] = []
        try:
            async for chunk in self._llm.stream(self._history):
                if self._aborted:
                    break

                # Token → event queue (frontend typing effect)
                if chunk.token:
                    full_text_parts.append(chunk.token)
                    await event_queue.put(self._ev(PipelineEventType.LLM_TOKEN, token=chunk.token))

                # Complete sentence → sentence queue (TTS)
                if chunk.sentence:
                    clean = clean_text_for_tts(chunk.sentence)
                    if clean:
                        logger.debug(f"LLM sentence ready: '{clean[:50]}'")
                        await sentence_queue.put(clean)

                # Stream done
                if chunk.is_done:
                    break

        except LLMException as e:
            await event_queue.put(
                self._ev(PipelineEventType.ERROR, code="LLM_ERROR", message=str(e))
            )
        except asyncio.CancelledError:
            logger.info(f"LLM worker cancelled for session {session_id}")
            raise
        finally:
            # Always signal TTS worker that LLM is done
            try:
                await sentence_queue.put(_LLM_DONE_SENTINEL)
            except asyncio.CancelledError:
                pass
            await event_queue.put(self._ev(PipelineEventType.LLM_DONE))
            logger.info(f"LLM worker done for session {session_id}")

    # ── Private: TTS Worker ───────────────────────────────────────────────────
    async def _tts_worker(
        self,
        sentence_queue: asyncio.Queue[Optional[str]],
        event_queue: asyncio.Queue[PipelineEvent],
        session_id: Optional[str] = None,
    ) -> None:
        """
        Consumes sentences from the queue and runs TTS on each.
        Runs concurrently with the LLM worker.
        """
        logger.info(f"TTS worker started for session {session_id}")
        sentence_index = 0

        try:
            while True:
                if self._aborted:
                    break

                # Wait for next sentence (blocks until LLM produces one)
                sentence = await sentence_queue.get()

                # Sentinel → LLM is done, no more sentences
                if sentence is _LLM_DONE_SENTINEL:
                    break

                sentence_index += 1
                logger.info(
                    f"TTS processing sentence {sentence_index} for session {session_id}: "
                    f"'{sentence[:50]}'"
                )
                await event_queue.put(self._ev(PipelineEventType.SPEAKING))

                try:
                    processor = TTSProcessor(self._tts, event_queue, sentence_index)
                    await processor.process(sentence)
                except TTSException as e:
                    logger.error(
                        f"TTS failed for sentence {sentence_index} in session {session_id}: {e}"
                    )
                    await event_queue.put(
                        self._ev(
                            PipelineEventType.ERROR,
                            code="TTS_ERROR",
                            message=str(e),
                            sentence_index=sentence_index,
                        )
                    )
                    # Continue with next sentence
                    continue
                except asyncio.CancelledError:
                    logger.info(f"TTS worker cancelled for session {session_id}")
                    raise

        except asyncio.CancelledError:
            logger.info(f"TTS worker cancelled for session {session_id}")
            raise
        finally:
            await event_queue.put(self._ev(PipelineEventType.TTS_DONE))
            logger.info(
                f"TTS worker done for session {session_id} | processed {sentence_index} sentences"
            )

    # ── Helper ─────────────────────────────────────────────────────────────────
    @staticmethod
    def _ev(event_type: PipelineEventType, **kwargs) -> PipelineEvent:
        """Shorthand to create a PipelineEvent."""
        return ev(event_type, **kwargs)
