import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.domain.chat.entities import ConversationHistory
from app.domain.voice.entities import TTSResult
from app.schemas.audio import AudioBuffer


@dataclass
class TurnContext:
    session_id: str
    message_id: str
    trace_id: str

    # Input Data
    audio_buffer: AudioBuffer | None = None
    text_input: str | None = None

    # State / History
    history: ConversationHistory | None = None
    original_system_prompt: str | None = None

    # Extracted Output
    asr_transcript: str | None = None
    llm_full_response: str | None = None
    llm_emotion: str | None = None
    tts_voice: str | None = None
    tts_result: TTSResult | None = None
    mouth_cues: list = field(default_factory=list)
    timeline: list = field(default_factory=list)

    # Orchestration & Callbacks
    send_callback: Callable[[Any], asyncio.Future] | None = None
    send_binary_callback: Callable[[bytes], asyncio.Future] | None = None
    aborted: bool = False

    # A queue to handle streaming items between LLM and TTS if needed
    sentence_queue: asyncio.Queue[str | None] = field(default_factory=lambda: asyncio.Queue(maxsize=5))
    current_sentence: str | None = None
    sentence_index: int = 0

    def abort(self) -> None:
        self.aborted = True
