import re
from abc import ABC, abstractmethod
from loguru import logger

from app.application.voice.pipeline_context import TurnContext
from app.domain.chat.ports import BaseLLMProvider
from app.domain.voice.ports import BaseTTSProvider
from app.infrastructure.cache.chat_context_cache import push_message as push_ctx
from app.infrastructure.db.database import AsyncSessionLocal
from app.infrastructure.db.repositories.chat_repository import ChatRepository
from app.schemas.ws_messages import (
    make_error, make_chat_delta, make_chat_final, make_tts_ready, make_visemes_ready,
    make_animation_timeline_v2, make_pipeline_state
)
from app.shared.errors import LLMException, TTSException
from app.application.chat.prompt_builder import PromptBuilder

_EMOTION_RE = re.compile(r"^\[emotion:(\w+)]\s*")
_VALID_EMOTIONS = {
    "neutral", "happy", "sad", "surprised", "angry", "thinking", "confused",
    "empathetic", "excited", "concerned", "reassuring", "proud",
    "disappointed", "sarcastic", "grateful", "curious",
}

class BaseStage(ABC):
    @abstractmethod
    async def process(self, context: TurnContext) -> None:
        pass


class ASRStage(BaseStage):
    """Placeholder for ASR if integrated into the sequential pipeline."""
    async def process(self, context: TurnContext) -> None:
        if context.aborted:
            return
        pass


class LLMStage(BaseStage):
    def __init__(self, llm: BaseLLMProvider | None, retrieval=None):
        self._llm = llm
        self._retrieval = retrieval

    async def process(self, context: TurnContext) -> None:
        if context.aborted or not context.text_input:
            return

        original_sys_prompt = context.history.system_prompt
        context.original_system_prompt = original_sys_prompt

        if self._retrieval:
            try:
                retrieved = await self._retrieval.execute(context.text_input, session_id=context.session_id)
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
                if chunk.is_done:
                    break
        except LLMException as e:
            logger.error(f"LLM error: {e} | trace_id={context.trace_id}")
            if context.send_callback:
                await context.send_callback(make_error(
                    code="LLM_ERROR", message=str(e),
                    session_id=context.session_id, message_id=context.message_id
                ))
            context.abort()
            return
        finally:
            context.history.system_prompt = original_sys_prompt

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
                await context.send_callback(make_error(
                    code="EMPTY_RESPONSE", message="LLM returned empty response",
                    session_id=context.session_id, message_id=context.message_id
                ))
            context.abort()
            return

        if context.send_callback:
            await context.send_callback(
                make_chat_final(
                    session_id=context.session_id, message_id=context.message_id,
                    text=full_response, emotion=emotion
                )
            )

        context.history.add_assistant_message(full_response)


class SentenceSegmentationStage(BaseStage):
    """Splits full response into sentences for sequential processing if needed."""
    async def process(self, context: TurnContext) -> None:
        if context.aborted or not context.llm_full_response:
            return
        # Currently, process_message generates TTS for the full response at once.
        # This stage is a structural hook that can be expanded when migrating
        # fully to sentence-level TTS streaming in the unified pipeline.
        await context.sentence_queue.put(context.llm_full_response)
        await context.sentence_queue.put(None) # sentinel


class TTSStage(BaseStage):
    def __init__(self, tts: BaseTTSProvider | None):
        self._tts = tts

    async def process(self, context: TurnContext) -> None:
        if context.aborted or not context.llm_full_response:
            return

        if context.send_callback:
            await context.send_callback(make_pipeline_state(context.session_id, "speaking"))

        if not self._tts:
            raise TTSException("TTS service not configured")

        try:
            tts_result = await self._tts.generate(
                text=context.llm_full_response,
                session_id=context.session_id,
                message_id=context.message_id,
                trace_id=context.trace_id,
            )
            context.tts_result = tts_result
            
            # Send raw binary audio frame directly if callback is available
            if context.send_binary_callback and tts_result.audio_bytes:
                await context.send_binary_callback(tts_result.audio_bytes)
                
        except TTSException as e:
            logger.error(f"TTS error: {e} | trace_id={context.trace_id}")
            if context.send_callback:
                await context.send_callback(make_error(
                    code="TTS_ERROR", message=str(e),
                    session_id=context.session_id, message_id=context.message_id
                ))
            context.tts_result = None


class AnimationStage(BaseStage):
    def __init__(self, animation_service):
        self._animation_service = animation_service
        self._recent_animation_assets: list[str] = []
        self._profile_usage: dict[str, int] = {}
        self._intent_history: list[str] = []

    async def process(self, context: TurnContext) -> None:
        if context.aborted or not context.llm_full_response:
            return

        from app.infrastructure.tts.viseme_generator import VisemeGenerator
        viseme_generator = VisemeGenerator()

        if context.tts_result and getattr(context.tts_result, "audio_ref", None):
            mouth_cues = await viseme_generator.generate_from_audio(
                audio_path=context.tts_result.audio_ref,
                text=context.llm_full_response,
                session_id=context.session_id,
                message_id=context.message_id,
            )
        else:
            mouth_cues = []
        context.mouth_cues = mouth_cues

        from app.domain.voice.entities import TTSResult
        from app.application.animation.audio_analysis import analyze_tts_for_animation

        safe_tts_result = context.tts_result or TTSResult(
            audio_bytes=b"", visemes=[], word_boundaries=[],
            audio_duration_ms=len(context.llm_full_response) * 60.0
        )

        audio_features = analyze_tts_for_animation(
            tts_result=safe_tts_result,
            mouth_cues=mouth_cues,
            text=context.llm_full_response,
        )

        timeline_payload = self._animation_service.build_timeline_v2(
            text=context.llm_full_response,
            audio_features=audio_features,
            recent_assets=self._recent_animation_assets,
            emotion=context.llm_emotion,
            profile_usage=self._profile_usage,
            intent_history=self._intent_history,
        )
        context.timeline = timeline_payload["timeline"]

        audio_url = f"/api/v1/audio/{context.session_id}/{context.message_id}.mp3" if context.tts_result else ""
        duration = int(context.tts_result.audio_duration_ms) if context.tts_result else 0
        
        if context.send_callback:
            if audio_url:
                await context.send_callback(make_tts_ready(
                    session_id=context.session_id, message_id=context.message_id,
                    audio_url=audio_url, duration_ms=duration
                ))
            await context.send_callback(make_visemes_ready(
                session_id=context.session_id, message_id=context.message_id,
                mouth_cues=mouth_cues
            ))

            if timeline_payload["timeline"]:
                await context.send_callback(make_animation_timeline_v2(
                    session_id=context.session_id, message_id=context.message_id,
                    timeline=timeline_payload["timeline"], meta=timeline_payload.get("meta", {})
                ))
                self._recent_animation_assets.extend(
                    item["animation_asset"] for item in timeline_payload["timeline"]
                    if item.get("animation_asset") and item["animation_asset"] != "Idle"
                )
                self._recent_animation_assets = self._recent_animation_assets[-12:]
