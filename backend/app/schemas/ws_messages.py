"""
WebSocket contract between Frontend and Backend.
Each message has a specific type and specific data.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


# ── Message Types ─────────────────────────────────────────────────────────────
class ClientMessageType(str, Enum):
    """Messages FROM Frontend TO Backend."""
    AUDIO_CHUNK = "audio_chunk"      # Audio chunk from microphone (base64)
    AUDIO_END   = "audio_end"        # Recording finished → send to ASR
    TEXT_INPUT  = "text_input"       # Direct text input (no audio)
    PING        = "ping"              # Heartbeat
    ABORT       = "abort"             # Cancel current response


class ServerMessageType(str, Enum):
    """Messages FROM Backend TO Frontend."""
    # Pipeline status
    STATUS      = "status"

    # ASR
    TRANSCRIPT  = "transcript"        # Recognized text

    # LLM
    LLM_START   = "llm_start"         # Started thinking
    LLM_CHUNK   = "llm_chunk"         # Streaming token
    LLM_END     = "llm_end"           # Response finished

    # TTS
    TTS_START   = "tts_start"         # Audio started
    TTS_CHUNK   = "tts_chunk"         # Audio chunk (base64)
    TTS_END     = "tts_end"           # Audio finished
    VISEMES     = "visemes"           # Lip movement data

    # System
    PONG        = "pong"
    ERROR       = "error"
    READY       = "ready"             # Backend is ready


class AvatarStatus(str, Enum):
    """Avatar states for frontend UI."""
    IDLE       = "idle"
    LISTENING  = "listening"
    PROCESSING = "processing"        # ASR working
    THINKING   = "thinking"          # LLM working
    SPEAKING   = "speaking"          # TTS working


# ── Client Messages ───────────────────────────────────────────────────────────
class ClientMessage(BaseModel):
    """Generic client message with type and data."""
    type: ClientMessageType
    data: dict[str, Any] = Field(default_factory=dict)
    session_id: Optional[str] = None


class AudioChunkMessage(BaseModel):
    """Payload for AUDIO_CHUNK message."""
    chunk: str  # base64 encoded audio


class AudioEndMessage(BaseModel):
    """Payload for AUDIO_END message."""
    total_chunks: int


class TextInputMessage(BaseModel):
    """Payload for TEXT_INPUT message."""
    text: str
    language: str = "en"


# ── Server Messages ───────────────────────────────────────────────────────────
class ServerMessage(BaseModel):
    """Generic server message with type and data."""
    type: ServerMessageType
    data: dict[str, Any] = Field(default_factory=dict)

    def to_json(self) -> str:
        return self.model_dump_json()


# ── Viseme Data ───────────────────────────────────────────────────────────────
class VisemeEvent(BaseModel):
    """Single viseme event."""
    offset_ms: float      # Event time in milliseconds
    viseme_id: int        # Viseme number (0-21)
    duration_ms: float    # Viseme duration


class VisemesData(BaseModel):
    """All visemes for a complete sentence."""
    events: list[VisemeEvent]
    audio_duration_ms: float


# ── Helper Functions ──────────────────────────────────────────────────────────
def make_status_msg(status: AvatarStatus) -> ServerMessage:
    return ServerMessage(
        type=ServerMessageType.STATUS,
        data={"status": status.value}
    )


def make_error_msg(code: str, message: str) -> ServerMessage:
    return ServerMessage(
        type=ServerMessageType.ERROR,
        data={"code": code, "message": message}
    )


def make_transcript_msg(text: str, is_final: bool = True) -> ServerMessage:
    return ServerMessage(
        type=ServerMessageType.TRANSCRIPT,
        data={"text": text, "is_final": is_final}
    )


def make_llm_chunk_msg(token: str) -> ServerMessage:
    return ServerMessage(
        type=ServerMessageType.LLM_CHUNK,
        data={"token": token}
    )


def make_llm_end_msg(full_text: str) -> ServerMessage:
    return ServerMessage(
        type=ServerMessageType.LLM_END,
        data={"full_text": full_text}
    )


def make_tts_start_msg(total_chunks: int) -> ServerMessage:
    return ServerMessage(
        type=ServerMessageType.TTS_START,
        data={"total_chunks": total_chunks}
    )


def make_tts_chunk_msg(audio_b64: str, chunk_index: int) -> ServerMessage:
    return ServerMessage(
        type=ServerMessageType.TTS_CHUNK,
        data={"audio": audio_b64, "index": chunk_index}
    )


def make_tts_end_msg() -> ServerMessage:
    return ServerMessage(
        type=ServerMessageType.TTS_END,
        data={}
    )


def make_visemes_msg(visemes: VisemesData) -> ServerMessage:
    return ServerMessage(
        type=ServerMessageType.VISEMES,
        data=visemes.model_dump()
    )


def make_ready_msg() -> ServerMessage:
    return ServerMessage(
        type=ServerMessageType.READY,
        data={"status": "ready"}
    )