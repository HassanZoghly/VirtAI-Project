"""
Pipeline internal events.
These flow through the pipeline and get converted
to WebSocket messages by the WebSocket handler.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Optional


class PipelineEventType(Enum):
    # ── Status ────────────────────────────────────────────────────────────────
    LISTENING = auto()  # mic is active
    PROCESSING = auto()  # ASR running
    THINKING = auto()  # LLM running
    SPEAKING = auto()  # TTS running
    IDLE = auto()  # done

    # ── ASR ───────────────────────────────────────────────────────────────────
    TRANSCRIPT = auto()  # ASR result ready

    # ── LLM ───────────────────────────────────────────────────────────────────
    LLM_TOKEN = auto()  # single token
    LLM_SENTENCE = auto()  # full sentence ready → triggers TTS
    LLM_DONE = auto()  # full response done

    # ── TTS ───────────────────────────────────────────────────────────────────
    TTS_VISEMES = auto()  # viseme events for a sentence
    TTS_AUDIO = auto()  # audio chunk
    TTS_DONE = auto()  # sentence TTS done

    # ── Errors ────────────────────────────────────────────────────────────────
    ERROR = auto()
    WARNING = auto()  # non-fatal warning

    # ── Control ───────────────────────────────────────────────────────────────
    ABORT = auto()  # stop everything
    HEARTBEAT = auto()  # keepalive
    CLEANUP = auto()  # session cleanup


# ── Event Data Classes ────────────────────────────────────────────────────────
@dataclass
class PipelineEvent:
    type: PipelineEventType
    data: dict = field(default_factory=dict)
    session_id: Optional[str] = None  # for tracking


# ── Helpers ───────────────────────────────────────────────────────────────────
def ev(event_type: PipelineEventType, **kwargs) -> PipelineEvent:
    """Shorthand to create a PipelineEvent"""
    return PipelineEvent(type=event_type, data=kwargs)
