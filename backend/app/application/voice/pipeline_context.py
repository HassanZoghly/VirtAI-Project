import asyncio
from dataclasses import dataclass, field
from typing import Callable, Any

from app.schemas.audio import AudioBuffer
from app.domain.chat.entities import ConversationHistory
from app.domain.voice.entities import TTSResult

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
    tts_result: TTSResult | None = None
    mouth_cues: list = field(default_factory=list)
    timeline: list = field(default_factory=list)
    
    # Orchestration & Callbacks
    send_callback: Callable[[Any], asyncio.Future] | None = None
    send_binary_callback: Callable[[bytes], asyncio.Future] | None = None
    aborted: bool = False
    
    # A queue to handle streaming items between LLM and TTS if needed
    sentence_queue: asyncio.Queue[str | None] = field(default_factory=asyncio.Queue)

    def abort(self) -> None:
        self.aborted = True
