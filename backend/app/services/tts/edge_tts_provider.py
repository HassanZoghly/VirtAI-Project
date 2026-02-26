import asyncio
import base64
import re
from typing import AsyncGenerator, List, Optional

import edge_tts
from edge_tts import Communicate
from loguru import logger

from app.core.config import get_settings
from app.core.errors import TTSException
from app.services.tts.base import (
    BaseTTSProvider,
    TTSChunk,
    TTSResult,
    VisemeEvent,
    WordBoundary,
)
from app.services.tts.viseme_map import get_morph_target
from app.services.tts.tts_utils import calculate_audio_duration

settings = get_settings()


class EdgeTTSProvider(BaseTTSProvider):
    """
    Edge TTS Provider
    Uses Microsoft Edge TTS for:
    1. High-quality natural voices
    2. Viseme events with precise timestamps
    3. Word boundary events (optional, via synthesis_events)
    4. Completely free
    """
    def __init__(
        self,
        voice: Optional[str] = None,
        rate: Optional[str] = None,
        volume: Optional[str] = None,
        pitch: Optional[str] = None,
    ):
        self.voice  = voice  or settings.TTS_VOICE
        self.rate   = rate   or settings.TTS_RATE
        self.volume = volume or settings.TTS_VOLUME
        self.pitch  = pitch  or settings.TTS_PITCH
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

    def _parse_viseme_event(self, event: dict) -> Optional[VisemeEvent]:
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
                duration_ms=60.0,    # temporary, will be refined later
            )
        except (KeyError, ValueError) as e:
            logger.warning(f"Failed to parse viseme event: {event} | {e}")
            return None

    def _parse_word_boundary(self, event: dict) -> Optional[WordBoundary]:
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
        visemes: List[VisemeEvent],
        word_boundaries: List[WordBoundary],
        audio_duration_ms: float,
    ) -> List[VisemeEvent]:
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
    async def synthesize(self, text: str) -> TTSResult:
        """
        Convert full text to audio + visemes
        Collects all chunks first
        """
        if not text.strip():
            raise TTSException("Empty text provided")
        logger.info(f"TTS synthesize | text_len={len(text)} | voice={self.voice}")

        audio_chunks: List[bytes] = []
        visemes: List[VisemeEvent] = []
        word_boundaries: List[WordBoundary] = []

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
            raise TTSException(f"TTS failed: {str(e)}")

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
                    delay = 2 ** attempt
                    logger.warning(f"TTS 403 error, retry {attempt+1}/{max_retries} after {delay}s: {e}")
                    await asyncio.sleep(delay)
                else:
                    logger.error(f"TTS streaming failed: {e}")
                    raise TTSException(f"TTS streaming failed: {str(e)}")

    async def get_available_voices(self) -> List[dict]:
        """
        Get available voices from Edge TTS
        """
        try:
            voices = await edge_tts.list_voices()
            result = []
            for voice in voices:
                locale = voice["Locale"]
                if locale.startswith("en-"):  # English only
                    result.append({
                        "id": voice["Name"],
                        "name": voice["ShortName"],
                        "language": locale,
                        "gender": voice["Gender"],
                        "description": f"{locale} - {voice['Gender']}",
                        "friendly_name": voice.get("FriendlyName", voice["ShortName"])
                    })
            return result
        except Exception as e:
            logger.error(f"Failed to fetch voices: {e}")
            return self._get_fallback_voices()

    def _get_fallback_voices(self) -> List[dict]:
        """Fallback English voices if API call fails"""
        return [
            {"id": "en-US-JennyNeural", "name": "Jenny", "language": "en-US", "gender": "Female", "description": "English (US) - Jenny", "friendly_name": "Jenny (English US)"},
            {"id": "en-US-GuyNeural", "name": "Guy", "language": "en-US", "gender": "Male", "description": "English (US) - Guy", "friendly_name": "Guy (English US)"},
            {"id": "en-US-AriaNeural", "name": "Aria", "language": "en-US", "gender": "Female", "description": "English (US) - Aria", "friendly_name": "Aria (English US)"},
            {"id": "en-US-ChristopherNeural", "name": "Christopher", "language": "en-US", "gender": "Male", "description": "English (US) - Christopher", "friendly_name": "Christopher (English US)"},
            {"id": "en-GB-SoniaNeural", "name": "Sonia", "language": "en-GB", "gender": "Female", "description": "English (UK) - Sonia", "friendly_name": "Sonia (English UK)"},
            {"id": "en-GB-RyanNeural", "name": "Ryan", "language": "en-GB", "gender": "Male", "description": "English (UK) - Ryan", "friendly_name": "Ryan (English UK)"},
            {"id": "en-AU-NatashaNeural", "name": "Natasha", "language": "en-AU", "gender": "Female", "description": "English (AU) - Natasha", "friendly_name": "Natasha (English Australia)"},
            {"id": "en-AU-WilliamNeural", "name": "William", "language": "en-AU", "gender": "Male", "description": "English (AU) - William", "friendly_name": "William (English Australia)"},
            {"id": "en-CA-ClaraNeural", "name": "Clara", "language": "en-CA", "gender": "Female", "description": "English (CA) - Clara", "friendly_name": "Clara (English Canada)"},
            {"id": "en-CA-LiamNeural", "name": "Liam", "language": "en-CA", "gender": "Male", "description": "English (CA) - Liam", "friendly_name": "Liam (English Canada)"},
            {"id": "en-IN-NeerjaNeural", "name": "Neerja", "language": "en-IN", "gender": "Female", "description": "English (IN) - Neerja", "friendly_name": "Neerja (English India)"},
            {"id": "en-IN-PrabhatNeural", "name": "Prabhat", "language": "en-IN", "gender": "Male", "description": "English (IN) - Prabhat", "friendly_name": "Prabhat (English India)"},
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
            "volume": {"min": "-50%", "max": "+50%", "default": self.volume}
        }