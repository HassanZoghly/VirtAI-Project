import asyncio
import re
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any, Optional

import edge_tts
from edge_tts import Communicate
from loguru import logger

from app.shared.errors import TTSException
from app.domain.voice.entities import TTSChunk, TTSResult, VisemeEvent, WordBoundary
from app.domain.voice.ports import BaseTTSProvider
from app.infrastructure.tts.tts_utils import calculate_audio_duration
from app.infrastructure.cache.tts_cache import cache_audio, get_cached_audio


class EdgeTTSProvider(BaseTTSProvider):
    """
    Edge TTS Provider
    Uses Microsoft Edge TTS for:
    1. High-quality natural voices
    2. Viseme events with precise timestamps
    3. Word boundary events (optional, via synthesis_events)
    4. Completely free

    Configuration is injected via constructor parameters.
    """

    def __init__(
        self,
        voice: str = "en-US-AriaNeural",
        rate: str = "+0%",
        volume: str = "+0%",
        pitch: str = "+0Hz",
    ):
        """
        Initialize EdgeTTSProvider with configuration.

        Args:
            voice: Voice identifier (e.g., "en-US-AriaNeural")
            rate: Speech rate adjustment (e.g., "+0%", "+10%", "-10%")
            volume: Volume adjustment (e.g., "+0%", "+10%", "-10%")
            pitch: Pitch adjustment (e.g., "+0Hz", "+10Hz", "-10Hz")
        """
        self.voice = voice
        self.rate = rate
        self.volume = volume
        self.pitch = pitch
        logger.info(f"EdgeTTS initialized | voice={self.voice}")

    # ── Private Helpers ───────────────────────────────────────────────────────
    def _make_communicate(self, text: str) -> Communicate:
        """Create Communicate instance with current settings"""
        return Communicate(
            text=text,
            voice=self.voice,
            rate=self.rate,
            volume=self.volume,
            pitch=self.pitch,
            proxy=None,
        )

    def _parse_viseme_offset(self, offset_100ns: int) -> float:
        """Edge TTS gives offset in 100-nanosecond units → milliseconds"""
        return offset_100ns / 10_000.0

    def _parse_viseme_event(self, event: dict | Any) -> Optional[VisemeEvent]:
        """
        Convert edge_tts viseme event to VisemeEvent object
        edge_tts event format:
        {
            "type": "viseme",
            "offset": 10500000,      ← 100-nanosecond units
            "viseme_id": 7
        }
        """
        try:
            offset_ms = self._parse_viseme_offset(event["offset"])
            viseme_id = int(event["viseme_id"])
            return VisemeEvent(
                offset_ms=offset_ms,
                viseme_id=viseme_id,
                duration_ms=60.0,  # temporary, will be refined later
            )
        except (KeyError, ValueError) as e:
            logger.warning(f"Failed to parse viseme event: {event} | {e}")
            return None

    def _parse_word_boundary(self, event: dict | Any) -> Optional[WordBoundary]:
        """
        Convert edge_tts word boundary event to WordBoundary object
        edge_tts word boundary format:
        {
            "type": "word_boundary",
            "offset": 10500000,
            "duration": 5000000,      ← 100-nanosecond units
            "text": "hello"
        }
        """
        try:
            offset_ms = self._parse_viseme_offset(event["offset"])
            duration_ms = self._parse_viseme_offset(event["duration"])
            word = event["text"]
            return WordBoundary(
                word=word,
                offset_ms=offset_ms,
                duration_ms=duration_ms,
            )
        except (KeyError, ValueError) as e:
            logger.warning(f"Failed to parse word boundary: {event} | {e}")
            return None

    def _calculate_viseme_durations(
        self,
        visemes: list[VisemeEvent],
        word_boundaries: list[WordBoundary],
        audio_duration_ms: float,
    ) -> list[VisemeEvent]:
        """
        Calculate duration for each viseme based on:
        1. Next viseme offset (if available)
        2. Next word boundary (if available)
        3. Fallback to default 60ms
        """
        if not visemes:
            return visemes

        # Create a combined timeline of all events
        events = []
        for v in visemes:
            events.append((v.offset_ms, "viseme", v))
        for w in word_boundaries:
            events.append((w.offset_ms, "word", w))
        events.sort(key=lambda x: x[0])

        for i, (_, _, viseme) in enumerate([e for e in events if e[1] == "viseme"]):
            next_viseme = None
            # Find next viseme event
            for j in range(i + 1, len(events)):
                if events[j][1] == "viseme":
                    next_viseme = events[j][2]
                    break

            if next_viseme:
                viseme.duration_ms = max(next_viseme.offset_ms - viseme.offset_ms, 20.0)
            else:
                # Last viseme: lasts until end of audio
                viseme.duration_ms = max(audio_duration_ms - viseme.offset_ms, 60.0)

        return visemes

    # ── Public Methods ────────────────────────────────────────────────────────
    async def generate(
        self,
        text: str,
        session_id: str,
        message_id: str,
    ) -> TTSResult:
        """
        Generate audio and store at backend/.data/sessions/{session_id}/{message_id}.mp3

        Args:
            text: Text to synthesize
            session_id: Session identifier
            message_id: Message identifier

        Returns:
            TTSResult with file_path and duration_ms populated

        Raises:
            TTSException: If synthesis fails or file storage fails
        """
        if not text.strip():
            raise TTSException("Empty text provided")

        # Validate session_id and message_id to prevent path traversal
        if not self._is_safe_path_component(session_id):
            raise TTSException(f"Invalid session_id: {session_id}")
        if not self._is_safe_path_component(message_id):
            raise TTSException(f"Invalid message_id: {message_id}")

        logger.info(
            f"TTS generate | session={session_id} | message={message_id} | text_len={len(text)}"
        )

        # Try Redis cache first to avoid repeated synthesis for identical text+voice.
        cached_audio = await get_cached_audio(text=text, voice=self.voice)
        if cached_audio is not None:
            logger.info(
                f"TTS cache hit | session={session_id} | message={message_id} | "
                f"voice={self.voice} | bytes={len(cached_audio):,}"
            )
            result = TTSResult(
                audio_bytes=cached_audio,
                visemes=[],
                word_boundaries=[],
                audio_duration_ms=calculate_audio_duration(cached_audio, format="mp3"),
            )
        else:
            # Cache miss -> synthesize then store in Redis.
            result = await self.synthesize(text)
            await cache_audio(text=text, voice=self.voice, audio_bytes=result.audio_bytes)

        # Create storage directory
        from app.shared.config import get_settings

        storage_base = Path(get_settings().AUDIO_STORAGE_PATH)
        session_dir = storage_base / session_id
        session_dir.mkdir(parents=True, exist_ok=True)

        # Store audio file
        audio_file_path = session_dir / f"{message_id}.mp3"
        try:
            audio_file_path.write_bytes(result.audio_bytes)
            logger.success(
                f"Audio saved | path={audio_file_path} | size={len(result.audio_bytes):,}B"
            )
        except Exception as e:
            logger.error(f"Failed to save audio file: {e}")
            raise TTSException(f"Failed to save audio: {e!s}")

        # Update result with file path (relative to backend directory)
        result.file_path = str(audio_file_path)

        return result

    def _is_safe_path_component(self, component: str) -> bool:
        """
        Validate that a path component is safe (no path traversal)

        Args:
            component: Path component to validate

        Returns:
            True if safe, False otherwise
        """
        if not component:
            return False
        # Check for path traversal attempts
        if ".." in component or "/" in component or "\\" in component:
            return False
        # Check for valid characters (alphanumeric, dash, underscore)
        if not re.match(r"^[a-zA-Z0-9_-]+$", component):
            return False
        return True

    async def synthesize(self, text: str) -> TTSResult:
        """
        Convert full text to audio + visemes
        Collects all chunks first
        """
        if not text.strip():
            raise TTSException("Empty text provided")
        logger.info(f"TTS synthesize | text_len={len(text)} | voice={self.voice}")

        audio_chunks: list[bytes] = []
        visemes: list[VisemeEvent] = []
        word_boundaries: list[WordBoundary] = []

        try:
            communicate = self._make_communicate(text)
            async for event in communicate.stream():
                event_type = event.get("type")
                if event_type == "audio":
                    chunk_data = event.get("data")
                    if chunk_data:
                        audio_chunks.append(chunk_data)
                elif event_type == "viseme":
                    viseme = self._parse_viseme_event(event)
                    if viseme:
                        visemes.append(viseme)
                elif event_type == "word_boundary":
                    word = self._parse_word_boundary(event)
                    if word:
                        word_boundaries.append(word)
        except Exception as e:
            logger.error(f"TTS synthesis failed: {e}")
            raise TTSException(f"TTS failed: {e!s}")

        audio_bytes = b"".join(audio_chunks)
        if not audio_bytes:
            raise TTSException("TTS returned empty audio")

        # Accurate duration using pydub
        audio_duration_ms = calculate_audio_duration(audio_bytes, format="mp3")

        # Calculate viseme durations using word boundaries
        visemes = self._calculate_viseme_durations(visemes, word_boundaries, audio_duration_ms)

        logger.success(
            f"TTS done | "
            f"audio={len(audio_bytes):,}B | "
            f"visemes={len(visemes)} | "
            f"words={len(word_boundaries)} | "
            f"duration={audio_duration_ms:.0f}ms"
        )
        return TTSResult(
            audio_bytes=audio_bytes,
            visemes=visemes,
            word_boundaries=word_boundaries,
            audio_duration_ms=audio_duration_ms,
        )

    async def synthesize_streaming(
        self,
        text: str,
        max_retries: int = 3,
    ) -> AsyncGenerator[TTSChunk, None]:
        """
        Streaming synthesis with real-time visemes:
        1. Send visemes and word boundaries as they arrive
        2. Then send audio chunks as they arrive
        3. No need to wait for full audio to calculate durations
        """
        if not text.strip():
            raise TTSException("Empty text provided")
        logger.info(f"TTS streaming | text_len={len(text)}")

        for attempt in range(max_retries):
            try:
                # Store events for later duration calculation
                viseme_events = []
                word_boundaries = []
                audio_chunks = []

                communicate = self._make_communicate(text)
                async for event in communicate.stream():
                    event_type = event.get("type")

                    if event_type == "viseme":
                        viseme = self._parse_viseme_event(event)
                        if viseme:
                            viseme_events.append(viseme)
                            # Send immediately so frontend can start preparing
                            yield TTSChunk(viseme=viseme)

                    elif event_type == "word_boundary":
                        word = self._parse_word_boundary(event)
                        if word:
                            word_boundaries.append(word)
                            yield TTSChunk(word_boundary=word)

                    elif event_type == "audio":
                        chunk = event.get("data")
                        if chunk:
                            audio_chunks.append(chunk)
                            yield TTSChunk(audio_data=chunk)

                if not audio_chunks:
                    raise TTSException("TTS returned empty audio")

                # After streaming, we could recalculate viseme durations if needed
                # But they were already sent; frontend may adjust later

                yield TTSChunk(is_done=True)
                logger.success(
                    f"TTS streaming done | "
                    f"audio={sum(len(c) for c in audio_chunks):,}B | "
                    f"visemes={len(viseme_events)} | "
                    f"words={len(word_boundaries)}"
                )
                return

            except Exception as e:
                error_msg = str(e)
                if "403" in error_msg and attempt < max_retries - 1:
                    delay = 2**attempt
                    logger.warning(
                        f"TTS 403 error, retry {attempt+1}/{max_retries} after {delay}s: {e}"
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(f"TTS streaming failed: {e}")
                    raise TTSException(f"TTS streaming failed: {e!s}")

    async def get_available_voices(self) -> list[dict]:
        """
        Get available voices from Edge TTS
        """
        try:
            voices = await edge_tts.list_voices()
            result = []
            for voice in voices:
                locale = voice["Locale"]
                if locale.startswith("en-"):  # English only
                    result.append(
                        {
                            "id": voice["Name"],
                            "name": voice["ShortName"],
                            "language": locale,
                            "gender": voice["Gender"],
                            "description": f"{locale} - {voice['Gender']}",
                            "friendly_name": voice.get("FriendlyName", voice["ShortName"]),
                        }
                    )
            return result
        except Exception as e:
            logger.error(f"Failed to fetch voices: {e}")
            return self._get_fallback_voices()

    def _get_fallback_voices(self) -> list[dict]:
        """Fallback English voices if API call fails"""
        return [
            {
                "id": "en-US-JennyNeural",
                "name": "Jenny",
                "language": "en-US",
                "gender": "Female",
                "description": "English (US) - Jenny",
                "friendly_name": "Jenny (English US)",
            },
            {
                "id": "en-US-GuyNeural",
                "name": "Guy",
                "language": "en-US",
                "gender": "Male",
                "description": "English (US) - Guy",
                "friendly_name": "Guy (English US)",
            },
            {
                "id": "en-US-AriaNeural",
                "name": "Aria",
                "language": "en-US",
                "gender": "Female",
                "description": "English (US) - Aria",
                "friendly_name": "Aria (English US)",
            },
            {
                "id": "en-US-ChristopherNeural",
                "name": "Christopher",
                "language": "en-US",
                "gender": "Male",
                "description": "English (US) - Christopher",
                "friendly_name": "Christopher (English US)",
            },
            {
                "id": "en-GB-SoniaNeural",
                "name": "Sonia",
                "language": "en-GB",
                "gender": "Female",
                "description": "English (UK) - Sonia",
                "friendly_name": "Sonia (English UK)",
            },
            {
                "id": "en-GB-RyanNeural",
                "name": "Ryan",
                "language": "en-GB",
                "gender": "Male",
                "description": "English (UK) - Ryan",
                "friendly_name": "Ryan (English UK)",
            },
            {
                "id": "en-AU-NatashaNeural",
                "name": "Natasha",
                "language": "en-AU",
                "gender": "Female",
                "description": "English (AU) - Natasha",
                "friendly_name": "Natasha (English Australia)",
            },
            {
                "id": "en-AU-WilliamNeural",
                "name": "William",
                "language": "en-AU",
                "gender": "Male",
                "description": "English (AU) - William",
                "friendly_name": "William (English Australia)",
            },
            {
                "id": "en-CA-ClaraNeural",
                "name": "Clara",
                "language": "en-CA",
                "gender": "Female",
                "description": "English (CA) - Clara",
                "friendly_name": "Clara (English Canada)",
            },
            {
                "id": "en-CA-LiamNeural",
                "name": "Liam",
                "language": "en-CA",
                "gender": "Male",
                "description": "English (CA) - Liam",
                "friendly_name": "Liam (English Canada)",
            },
            {
                "id": "en-IN-NeerjaNeural",
                "name": "Neerja",
                "language": "en-IN",
                "gender": "Female",
                "description": "English (IN) - Neerja",
                "friendly_name": "Neerja (English India)",
            },
            {
                "id": "en-IN-PrabhatNeural",
                "name": "Prabhat",
                "language": "en-IN",
                "gender": "Male",
                "description": "English (IN) - Prabhat",
                "friendly_name": "Prabhat (English India)",
            },
        ]

    async def change_voice(self, voice_id: str) -> None:
        """Change voice at runtime"""
        voices = await self.get_available_voices()
        available = [v["id"] for v in voices]
        if voice_id not in available:
            raise TTSException(f"Voice '{voice_id}' not available")
        self.voice = voice_id
        logger.info(f"Voice changed to: {voice_id}")

    async def get_voice_settings(self, voice_name: str) -> dict:
        """Get available settings for a specific voice"""
        return {
            "rate": {"min": "-50%", "max": "+50%", "default": self.rate},
            "pitch": {"min": "-50Hz", "max": "+50Hz", "default": self.pitch},
            "volume": {"min": "-50%", "max": "+50%", "default": self.volume},
        }
