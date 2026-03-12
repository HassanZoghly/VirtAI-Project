"""
WebSocket Message Schemas for AI Avatar Chat

This module defines Pydantic models for all WebSocket messages exchanged between
the frontend and backend, including validation rules for protocol compliance.

Message Flow:
- Client -> Server: ChatUserMessage, ChatAbort, TTSRequest
- Server -> Client: ChatDelta, ChatFinal, PipelineState, TTSReady, VisemesReady, ErrorMessage
"""

from __future__ import annotations

from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ── Message Envelope ──────────────────────────────────────────────────────────
class WSMessageEnvelope(BaseModel):
    """
    Generic WebSocket message envelope.
    All messages are wrapped in this structure for type-safe routing.
    """

    type: str = Field(..., description="Message type identifier")
    data: dict[str, Any] = Field(default_factory=dict, description="Message payload")
    session_id: Optional[str] = Field(None, description="Session identifier (UUID)")
    message_id: Optional[str] = Field(None, description="Message identifier (UUID)")

    @field_validator("session_id", "message_id")
    @classmethod
    def validate_uuid_format(cls, v: Optional[str]) -> Optional[str]:
        """Validate that session_id and message_id are valid UUIDs when provided."""
        if v is not None:
            try:
                UUID(v)
            except ValueError:
                raise ValueError(f"Invalid UUID format: {v}")
        return v


# ── Client Messages (Frontend -> Backend) ─────────────────────────────────────
class ChatUserMessage(BaseModel):
    """
    Client sends a text message to start a conversation turn.

    Triggers: LLM streaming -> TTS generation -> Viseme generation
    """

    session_id: Optional[str] = Field(
        None, description="Session UUID (optional, server assigns if missing)"
    )
    message_id: str = Field(..., description="Unique message UUID")
    text: str = Field(..., min_length=1, max_length=2000, description="User message text")

    @field_validator("session_id", "message_id")
    @classmethod
    def validate_uuid_format(cls, v: Optional[str]) -> Optional[str]:
        """Validate UUID format."""
        if v is not None:
            try:
                UUID(v)
            except ValueError:
                raise ValueError(f"Invalid UUID format: {v}")
        return v

    @field_validator("text")
    @classmethod
    def validate_text_not_empty(cls, v: str) -> str:
        """Ensure text is not just whitespace."""
        if not v.strip():
            raise ValueError("Text cannot be empty or whitespace only")
        return v


class ChatAbort(BaseModel):
    """
    Client requests cancellation of current generation.

    Cancels: LLM streaming, TTS generation, and any pending operations
    """

    session_id: str = Field(..., description="Session UUID")
    message_id: str = Field(..., description="Message UUID to abort")

    @field_validator("session_id", "message_id")
    @classmethod
    def validate_uuid_format(cls, v: str) -> str:
        """Validate UUID format."""
        try:
            UUID(v)
        except ValueError:
            raise ValueError(f"Invalid UUID format: {v}")
        return v


class TTSRequest(BaseModel):
    """
    Client requests TTS generation for specific text.

    Optional: Used for standalone TTS without LLM generation
    """

    session_id: str = Field(..., description="Session UUID")
    message_id: str = Field(..., description="Message UUID")
    text: str = Field(..., min_length=1, max_length=2000, description="Text to synthesize")
    voice: Optional[str] = Field("en-US-AriaNeural", description="TTS voice identifier")
    rate: Optional[str] = Field("+0%", description="Speech rate adjustment")
    pitch: Optional[str] = Field("+0Hz", description="Pitch adjustment")

    @field_validator("session_id", "message_id")
    @classmethod
    def validate_uuid_format(cls, v: str) -> str:
        """Validate UUID format."""
        try:
            UUID(v)
        except ValueError:
            raise ValueError(f"Invalid UUID format: {v}")
        return v

    @field_validator("text")
    @classmethod
    def validate_text_not_empty(cls, v: str) -> str:
        """Ensure text is not just whitespace."""
        if not v.strip():
            raise ValueError("Text cannot be empty or whitespace only")
        return v


# ── Server Messages (Backend -> Frontend) ─────────────────────────────────────
class ChatDelta(BaseModel):
    """
    Server streams LLM tokens as they are generated.

    Sent multiple times during LLM generation for real-time display.
    """

    session_id: str = Field(..., description="Session UUID")
    message_id: str = Field(..., description="Message UUID")
    delta: str = Field(..., description="Token or text fragment")


class ChatFinal(BaseModel):
    """
    Server sends complete LLM response after streaming finishes.

    Sent once after all ChatDelta messages.
    """

    session_id: str = Field(..., description="Session UUID")
    message_id: str = Field(..., description="Message UUID")
    text: str = Field(..., description="Complete response text")
    emotion: Optional[str] = Field(None, description="Detected emotion from AI response")


class PipelineState(BaseModel):
    """
    Server notifies client of pipeline state changes.

    States:
    - idle: Ready for new input
    - thinking: LLM is generating response
    - speaking: TTS audio is playing
    - error: An error occurred
    """

    session_id: str = Field(..., description="Session UUID")
    state: Literal["idle", "thinking", "speaking", "error"] = Field(
        ..., description="Current pipeline state"
    )


class AudioData(BaseModel):
    """
    Audio file metadata for TTS output.
    """

    url: str = Field(..., description="URL path to audio file")
    mime: str = Field("audio/mpeg", description="MIME type")
    duration_ms: int = Field(..., ge=0, description="Audio duration in milliseconds")


class TTSReady(BaseModel):
    """
    Server notifies that TTS audio is ready for playback.

    Sent after TTS generation completes.
    """

    session_id: str = Field(..., description="Session UUID")
    message_id: str = Field(..., description="Message UUID")
    audio: AudioData = Field(..., description="Audio file information")


class MouthCue(BaseModel):
    """
    Single viseme/phoneme cue for lip synchronization.

    Represents a mouth shape at a specific time range.
    """

    start: float = Field(..., ge=0, description="Start time in seconds")
    end: float = Field(..., ge=0, description="End time in seconds")
    value: str = Field(..., description="Viseme name (e.g., 'viseme_aa')")

    @field_validator("end")
    @classmethod
    def validate_end_after_start(cls, v: float, info) -> float:
        """Ensure end time is after start time."""
        if "start" in info.data and v <= info.data["start"]:
            raise ValueError("End time must be greater than start time")
        return v


class VisemesReady(BaseModel):
    """
    Server sends viseme timeline for lip synchronization.

    Sent after viseme generation completes, used to animate avatar mouth.
    """

    session_id: str = Field(..., description="Session UUID")
    message_id: str = Field(..., description="Message UUID")
    format: Literal["mouthCues"] = Field("mouthCues", description="Timeline format")
    mouthCues: list[MouthCue] = Field(..., description="Viseme timeline")

    @field_validator("mouthCues")
    @classmethod
    def validate_sorted_cues(cls, v: list[MouthCue]) -> list[MouthCue]:
        """Ensure mouth cues are sorted by start time."""
        if len(v) > 1:
            for i in range(1, len(v)):
                if v[i].start < v[i - 1].start:
                    raise ValueError("Mouth cues must be sorted by start time")
        return v


class ErrorMessage(BaseModel):
    """
    Server reports an error to the client.

    Error codes:
    - INVALID_MESSAGE: Message validation failed
    - PIPELINE_ERROR: Error during LLM/TTS/Viseme generation
    - SESSION_ERROR: Session management error
    - TIMEOUT: Operation timed out
    """

    session_id: Optional[str] = Field(None, description="Session UUID (if applicable)")
    message_id: Optional[str] = Field(None, description="Message UUID (if applicable)")
    code: str = Field(..., description="Error code identifier")
    message: str = Field(..., description="Human-readable error message")
    details: Optional[dict[str, Any]] = Field(None, description="Additional error context")


# ── Helper Functions ──────────────────────────────────────────────────────────
def make_chat_delta(session_id: str, message_id: str, delta: str) -> ChatDelta:
    """Create a ChatDelta message."""
    return ChatDelta(session_id=session_id, message_id=message_id, delta=delta)


def make_chat_final(
    session_id: str, message_id: str, text: str, emotion: Optional[str] = None
) -> ChatFinal:
    """Create a ChatFinal message."""
    return ChatFinal(session_id=session_id, message_id=message_id, text=text, emotion=emotion)


def make_pipeline_state(
    session_id: str, state: Literal["idle", "thinking", "speaking", "error"]
) -> PipelineState:
    """Create a PipelineState message."""
    return PipelineState(session_id=session_id, state=state)


def make_tts_ready(session_id: str, message_id: str, audio_url: str, duration_ms: int) -> TTSReady:
    """Create a TTSReady message."""
    audio = AudioData(url=audio_url, duration_ms=duration_ms)
    return TTSReady(session_id=session_id, message_id=message_id, audio=audio)


def make_visemes_ready(
    session_id: str, message_id: str, mouth_cues: list[MouthCue]
) -> VisemesReady:
    """Create a VisemesReady message."""
    return VisemesReady(session_id=session_id, message_id=message_id, mouthCues=mouth_cues)


def make_error(
    code: str,
    message: str,
    session_id: Optional[str] = None,
    message_id: Optional[str] = None,
    details: Optional[dict] = None,
) -> ErrorMessage:
    """Create an ErrorMessage."""
    return ErrorMessage(
        session_id=session_id, message_id=message_id, code=code, message=message, details=details
    )


# ── Legacy Protocol (Old System) ──────────────────────────────────────────────
# These are kept for backward compatibility with the existing WebSocket implementation

import json
from enum import Enum


class ClientMessageType(str, Enum):
    """Legacy client message types"""

    AUDIO_CHUNK = "audio_chunk"
    AUDIO_END = "audio_end"
    TEXT_INPUT = "text_input"
    PING = "ping"
    ABORT = "abort"
    VOICE_MODE_STOP = "voice_mode_stop"


class ServerMessageType(str, Enum):
    """Legacy server message types"""

    READY = "ready"
    STATUS = "status"
    TRANSCRIPT = "transcript"
    LLM_START = "llm_start"
    LLM_CHUNK = "llm_chunk"
    LLM_END = "llm_end"
    TTS_START = "tts_start"
    TTS_CHUNK = "tts_chunk"
    TTS_END = "tts_end"
    VISEMES = "visemes"
    PONG = "pong"
    ERROR = "error"


class AvatarStatus(str, Enum):
    """Avatar state for legacy protocol"""

    IDLE = "idle"
    PROCESSING = "processing"
    THINKING = "thinking"
    SPEAKING = "speaking"


class ServerMessage(BaseModel):
    """Legacy server message wrapper"""

    type: ServerMessageType
    data: dict[str, Any] = Field(default_factory=dict)

    def to_json(self) -> str:
        """Convert to JSON string for WebSocket transmission"""
        return json.dumps({"type": self.type.value, "data": self.data})


class VisemeEvent(BaseModel):
    """Legacy viseme event"""

    offset_ms: float
    viseme_id: int
    duration_ms: float


class VisemesData(BaseModel):
    """Legacy visemes data"""

    events: list[VisemeEvent]
    audio_duration_ms: float


# Legacy helper functions
def make_error_msg(code: str, message: str) -> ServerMessage:
    """Create legacy error message"""
    return ServerMessage(type=ServerMessageType.ERROR, data={"code": code, "message": message})


def make_status_msg(status: AvatarStatus) -> ServerMessage:
    """Create legacy status message"""
    return ServerMessage(type=ServerMessageType.STATUS, data={"status": status.value})


def make_transcript_msg(text: str, is_final: bool = True) -> ServerMessage:
    """Create legacy transcript message"""
    return ServerMessage(
        type=ServerMessageType.TRANSCRIPT, data={"text": text, "is_final": is_final}
    )


def make_tts_chunk_msg(audio_b64: str, chunk_index: int) -> ServerMessage:
    """Create legacy TTS chunk message"""
    return ServerMessage(
        type=ServerMessageType.TTS_CHUNK, data={"audio": audio_b64, "chunk_index": chunk_index}
    )


def make_visemes_msg(visemes_data: VisemesData) -> ServerMessage:
    """Create legacy visemes message"""
    return ServerMessage(type=ServerMessageType.VISEMES, data=visemes_data.model_dump())


def make_llm_chunk_msg(token: str) -> ServerMessage:
    """Create legacy LLM chunk message"""
    return ServerMessage(type=ServerMessageType.LLM_CHUNK, data={"token": token})
