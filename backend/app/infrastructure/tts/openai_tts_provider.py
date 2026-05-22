import asyncio
import re
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import ClassVar

import httpx
from loguru import logger

from app.domain.voice.entities import TTSChunk, TTSResult
from app.domain.voice.ports import BaseTTSProvider
from app.infrastructure.cache.tts_cache import cache_audio, get_cached_audio
from app.infrastructure.tts.tts_utils import calculate_audio_duration
from app.shared.config import get_settings
from app.shared.errors import TTSException


class OpenAITTSProvider(BaseTTSProvider):
    """
    OpenAI-Compatible TTS Provider
    Uses a local Kokoro TTS container (openedai-speech) for high-fidelity audio.
    """

    VOICE_MAPPING: ClassVar[dict[str, str]] = {
        "aria": "nova",
        "jenny": "shimmer",
        "sonia": "alloy",
        "guy": "onyx",
        "christopher": "echo",
        "ryan": "fable",
    }

    SUPPORTED_VOICES: ClassVar[set[str]] = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}

    def __init__(self, voice: str = "aria", speed: float = 0.8, model: str = "tts-1", **kwargs):
        self.voice = voice
        self.speed = speed
        self.model = model if model in ("tts-1", "tts-1-hd") else "tts-1"
        self.api_url = "http://tts:8000/v1/audio/speech"
        logger.info(f"OpenAITTSProvider initialized | voice={self.voice} | model={self.model}")

    @property
    def api_voice(self) -> str:
        v = getattr(self, "voice", None)
        if not v or not isinstance(v, str):
            return "nova"
        v = v.lower()
        if v in self.SUPPORTED_VOICES:
            return v
        return self.VOICE_MAPPING.get(v, "nova")

    def get_voice_settings(self) -> dict:
        return {"voice": self.voice, "speed": getattr(self, "speed", 1.0)}

    def _sanitize_for_tts(self, text: str) -> str:
        """Sanitize text for TTS by expanding abbreviations and removing markdown/emojis."""
        if not text:
            return text

        # Expand common abbreviations (case-insensitive)
        text = re.sub(r"(?i)\bdr\.", "Doctor ", text)
        text = re.sub(r"(?i)\bmr\.", "Mister ", text)
        text = re.sub(r"(?i)\bmrs\.", "Missus ", text)
        text = re.sub(r"(?i)\bprof\.", "Professor ", text)

        # Remove Markdown symbols: *, #, _, ~, `
        text = re.sub(r"[*#_~`]", "", text)

        # Remove emojis and other non-standard characters
        # Keeps word characters (letters, digits), spaces, and standard punctuation/symbols
        text = re.sub(r'[^\w\s.,!?\'"\-;:()$%@&+=/\\<>|]', "", text)

        # Collapse multiple spaces
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def _is_safe_path_component(self, component: str) -> bool:
        if not component:
            return False
        if ".." in component or "/" in component or "\\" in component:
            return False
        if not re.match(r"^[a-zA-Z0-9_-]+$", component):
            return False
        return True

    async def generate(
        self,
        text: str,
        session_id: str,
        message_id: str,
    ) -> TTSResult:
        if not text.strip():
            raise TTSException("Empty text provided")

        if not self._is_safe_path_component(session_id):
            raise TTSException(f"Invalid session_id: {session_id}")
        if not self._is_safe_path_component(message_id):
            raise TTSException(f"Invalid message_id: {message_id}")

        logger.info(
            f"TTS generate | session={session_id} | message={message_id} | api_voice={self.api_voice}"
        )

        cached_audio = await get_cached_audio(text=text, voice=self.api_voice)
        if cached_audio is not None:
            logger.info("TTS cache hit")
            result = TTSResult(
                audio_bytes=cached_audio,
                visemes=[],
                word_boundaries=[],
                audio_duration_ms=calculate_audio_duration(cached_audio, format="mp3"),
            )
        else:
            result = await self.synthesize(text)
            await cache_audio(text=text, voice=self.api_voice, audio_bytes=result.audio_bytes)

        storage_base = Path(get_settings().AUDIO_STORAGE_PATH)
        session_dir = storage_base / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        audio_file_path = session_dir / f"{message_id}.mp3"
        try:
            audio_file_path.write_bytes(result.audio_bytes)
            logger.success(f"Audio saved | path={audio_file_path}")
        except Exception as e:
            logger.error(f"Failed to save audio: {e}")
            raise TTSException(f"Failed to save audio: {e!s}")

        result.audio_ref = str(audio_file_path)
        return result

    async def synthesize(self, text: str) -> TTSResult:
        text = self._sanitize_for_tts(text)
        if not text.strip():
            raise TTSException("Empty text provided")

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    self.api_url,
                    json={
                        "model": self.model,
                        "input": text,
                        "voice": self.api_voice,
                        "response_format": "mp3",
                        "speed": self.speed,
                    },
                )
                if response.status_code != 200:
                    logger.error(f"TTS API Error details: {response.text}")
                response.raise_for_status()
                audio_bytes = response.content
        except Exception as e:
            logger.error(f"TTS synthesis failed: {e}")
            raise TTSException(f"TTS failed: {e!s}")

        if not audio_bytes:
            raise TTSException("TTS returned empty audio")

        audio_duration_ms = calculate_audio_duration(audio_bytes, format="mp3")

        return TTSResult(
            audio_bytes=audio_bytes,
            visemes=[],
            word_boundaries=[],
            audio_duration_ms=audio_duration_ms,
        )

    async def synthesize_streaming(
        self, text: str, max_retries: int = 3
    ) -> AsyncGenerator[TTSChunk, None]:
        text = self._sanitize_for_tts(text)
        if not text.strip():
            raise TTSException("Empty text provided")

        settings = get_settings()
        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=settings.TTS_TIMEOUT_SEC) as client:
                    async with client.stream(
                        "POST",
                        self.api_url,
                        json={
                            "model": self.model,
                            "input": text,
                            "voice": self.api_voice,
                            "response_format": "mp3",
                            "speed": self.speed,
                        },
                    ) as response:
                        if response.status_code != 200:
                            error_details = await response.aread()
                            logger.error(
                                f"TTS API Error details: {error_details.decode('utf-8', errors='replace') if error_details else ''}"
                            )
                        response.raise_for_status()
                        async for chunk in response.aiter_bytes():
                            if chunk:
                                yield TTSChunk(audio_data=chunk)
                yield TTSChunk(is_done=True)
                return
            except Exception as e:
                if attempt < max_retries - 1:
                    await asyncio.sleep(2**attempt)
                else:
                    raise TTSException(f"TTS streaming failed: {e!s}")

    async def get_available_voices(self) -> list[dict]:
        return [{"id": "nova", "name": "Nova", "language": "en-US", "gender": "Female"}]
