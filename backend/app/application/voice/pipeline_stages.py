import asyncio
import collections
import contextlib
import re
from abc import ABC, abstractmethod
from pathlib import Path

from loguru import logger

from app.application.animation.audio_analysis import analyze_tts_for_animation
from app.application.chat.prompt_builder import PromptBuilder
from app.application.rag.intent_classifier import IntentClassifier
from app.application.voice.pipeline_context import TurnContext
from app.domain.chat.ports import BaseLLMProvider
from app.domain.voice.entities import TTSResult
from app.domain.voice.ports import BaseTTSProvider
from app.schemas.ws_messages import (
    make_animation_timeline_v2,
    make_chat_delta,
    make_chat_final,
    make_error,
    make_pipeline_state,
    make_tts_ready,
    make_visemes_ready,
)
from app.shared.errors import LLMException, TTSException

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


class BaseStage(ABC):
    @abstractmethod
    async def process(self, context: TurnContext) -> None:
        pass


class LLMStage(BaseStage):
    def __init__(self, llm: BaseLLMProvider | None, retrieval=None, intent_classifier: IntentClassifier | None = None):
        self._llm = llm
        self._retrieval = retrieval
        self._intent_classifier = intent_classifier

    async def process(self, context: TurnContext) -> None:
        if context.aborted or not context.text_input or not context.history:
            return

        original_sys_prompt = context.history.system_prompt
        context.original_system_prompt = original_sys_prompt

        if self._retrieval:
            try:
                is_casual = False
                if self._intent_classifier:
                    is_casual = await self._intent_classifier.async_is_casual_chat(context.text_input)

                if is_casual:
                    retrieved = ""
                else:
                    history_tokens = context.history.get_estimated_tokens()
                    retrieved = await self._retrieval.execute(
                        context.text_input, session_id=context.session_id, history_tokens=history_tokens
                    )
                context.history.system_prompt = PromptBuilder.build_system_prompt_with_context(
                    original_sys_prompt, retrieved
                )
            except Exception as e:
                logger.error(f"RAG retrieval failed: {e} | trace_id={context.trace_id}")

        if not self._llm:
            context.history.system_prompt = original_sys_prompt
            raise LLMException("LLM service not configured")

        full_response_parts: list[str] = []
        try:
            async for chunk in self._llm.stream(context.history, trace_id=context.trace_id):
                if context.aborted:
                    break
                if chunk.token:
                    full_response_parts.append(chunk.token)
                    if context.send_callback:
                        await context.send_callback(
                            make_chat_delta(
                                session_id=context.session_id,
                                message_id=context.message_id,
                                delta=chunk.token,
                            )
                        )
                if chunk.sentence:
                    sentence = chunk.sentence
                    # Strip emotion tag from the first sentence before TTS
                    if context.llm_emotion is None:
                        emotion_match = _EMOTION_RE.match(sentence)
                        if emotion_match:
                            detected = emotion_match.group(1).lower()
                            if detected in _VALID_EMOTIONS:
                                context.llm_emotion = detected
                            sentence = _EMOTION_RE.sub("", sentence).strip()
                    if sentence:
                        # Bug 1 Fix: strip all bracketed metadata before TTS
                        clean_sentence = re.sub(r"\[.*?\]", "", sentence).strip()
                        try:
                            await context.sentence_queue.put(clean_sentence)
                        except asyncio.CancelledError:
                            break
                if chunk.is_done:
                    break
        except LLMException as e:
            logger.error(f"LLM error: {e} | trace_id={context.trace_id}")
            if context.send_callback:
                await context.send_callback(
                    make_error(
                        code="LLM_ERROR",
                        message=str(e),
                        session_id=context.session_id,
                        message_id=context.message_id,
                    )
                )
            context.abort()
            return
        finally:
            context.history.system_prompt = original_sys_prompt
            # Ensure the audio consumer task unblocks when LLM finishes or fails
            with contextlib.suppress(asyncio.CancelledError):
                await context.sentence_queue.put(None)

        if context.aborted:
            return

        full_response = "".join(full_response_parts).strip()
        emotion = None
        emotion_match = _EMOTION_RE.match(full_response)
        if emotion_match:
            detected = emotion_match.group(1).lower()
            if detected in _VALID_EMOTIONS:
                emotion = detected
            full_response = _EMOTION_RE.sub("", full_response).strip()

        context.llm_full_response = full_response
        context.llm_emotion = emotion

        if not full_response:
            if context.send_callback:
                await context.send_callback(
                    make_error(
                        code="EMPTY_RESPONSE",
                        message="LLM returned empty response",
                        session_id=context.session_id,
                        message_id=context.message_id,
                    )
                )
            context.abort()
            return

        if context.send_callback:
            await context.send_callback(
                make_chat_final(
                    session_id=context.session_id,
                    message_id=context.message_id,
                    text=full_response,
                    emotion=emotion,
                )
            )

        context.history.add_assistant_message(full_response)


class SentenceSegmentationStage(BaseStage):
    """Splits full response into sentences for sequential processing if needed."""

    async def process(self, context: TurnContext) -> None:
        # Replaced by concurrent LLM sentence generation
        pass


class TTSStage(BaseStage):
    def __init__(self, tts: BaseTTSProvider | None):
        self._tts = tts

    async def process(self, context: TurnContext) -> None:
        text_to_speak = context.current_sentence
        if context.aborted or not text_to_speak or not context.history:
            return

        if context.send_callback:
            await context.send_callback(make_pipeline_state(context.session_id, "speaking"))

        if not self._tts:
            raise TTSException("TTS service not configured")

        try:
            tts_result = await self._tts.generate(
                text=text_to_speak,
                session_id=context.session_id,
                message_id=f"{context.message_id}_{context.sentence_index}",
                trace_id=context.trace_id,
                voice=context.tts_voice,
            )
            context.tts_result = tts_result

        except TTSException as e:
            logger.error(f"TTS error: {e} | trace_id={context.trace_id}")
            if context.send_callback:
                await context.send_callback(
                    make_error(
                        code="TTS_ERROR",
                        message=str(e),
                        session_id=context.session_id,
                        message_id=context.message_id,
                    )
                )
            context.tts_result = None


class AnimationStage(BaseStage):
    def __init__(self, animation_service, viseme_generator):
        self._animation_service = animation_service
        self._viseme_generator = viseme_generator
        self._recent_animation_assets: list[str] = []
        self._profile_usage: dict[str, int] = collections.defaultdict(int)
        self._intent_history: list[str] = []

    async def process(self, context: TurnContext) -> None:
        text_to_animate = context.current_sentence
        if context.aborted or not text_to_animate or not context.history:
            return

        chunk_message_id = f"{context.message_id}_{context.sentence_index}"

        if context.tts_result and getattr(context.tts_result, "audio_ref", None):
            mouth_cues = await self._viseme_generator.generate_from_audio(
                audio_path=context.tts_result.audio_ref,
                text=text_to_animate,
                session_id=context.session_id,
                message_id=chunk_message_id,
            )
        else:
            mouth_cues = []
        context.mouth_cues = mouth_cues

        safe_tts_result = context.tts_result or TTSResult(
            audio_bytes=b"",
            visemes=[],
            word_boundaries=[],
            audio_duration_ms=len(text_to_animate or "") * 60.0,
        )

        audio_features = analyze_tts_for_animation(
            tts_result=safe_tts_result,
            mouth_cues=mouth_cues,
            text=text_to_animate,
        )

        timeline_payload = self._animation_service.build_timeline_v2(
            text=text_to_animate,
            audio_features=audio_features,
            recent_assets=self._recent_animation_assets,
            emotion=context.llm_emotion,
            profile_usage=self._profile_usage,
            intent_history=self._intent_history,
        )
        context.timeline = timeline_payload["timeline"]

        audio_file_id = (
            Path(context.tts_result.audio_ref).stem
            if context.tts_result and context.tts_result.audio_ref
            else chunk_message_id
        )
        audio_url = f"/api/v1/audio/{context.session_id}/{audio_file_id}.mp3" if context.tts_result else ""
        duration = int(context.tts_result.audio_duration_ms) if context.tts_result else 0

        if context.send_callback:
            if audio_url:
                await context.send_callback(
                    make_tts_ready(
                        session_id=context.session_id,
                        message_id=chunk_message_id,
                        audio_url=audio_url,
                        duration_ms=duration,
                    )
                )
            await context.send_callback(
                make_visemes_ready(
                    session_id=context.session_id,
                    message_id=chunk_message_id,
                    mouth_cues=mouth_cues,
                )
            )

            if timeline_payload["timeline"]:
                await context.send_callback(
                    make_animation_timeline_v2(
                        session_id=context.session_id,
                        message_id=chunk_message_id,
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
