"""
WebSocket Message Schemas for AI Avatar Chat

This module defines Pydantic models for all WebSocket messages exchanged between
the frontend and backend, including validation rules for protocol compliance.

Message Flow:
- Client -> Server: ChatUserMessage, ChatAbort, TTSRequest
- Server -> Client: ChatDelta, ChatFinal, PipelineState, TTSReady, VisemesReady, ErrorMessage
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.shared.ids import parse_uuid


def _normalize_optional_identifier(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        raise ValueError("Identifier cannot be empty")
    parsed = parse_uuid(normalized)
    if parsed is None:
        raise ValueError("Identifier must be a UUID")
    return str(parsed)


def _normalize_required_identifier(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("Identifier cannot be empty")
    parsed = parse_uuid(normalized)
    if parsed is None:
        raise ValueError("Identifier must be a UUID")
    return str(parsed)


# ── Message Envelope ──────────────────────────────────────────────────────────
class WSMessageEnvelope(BaseModel):
    """
    Generic WebSocket message envelope.
    All messages are wrapped in this structure for type-safe routing.
    """

    type: str = Field(..., description="Message type identifier")
    data: dict[str, Any] = Field(default_factory=dict, description="Message payload")
    session_id: str | None = Field(None, description="Session identifier")
    message_id: str | None = Field(None, description="Message identifier")

    @field_validator("session_id", "message_id")
    @classmethod
    def validate_identifier_format(cls, v: str | None) -> str | None:
        """Validate that optional identifiers are non-empty when provided."""
        return _normalize_optional_identifier(v)


# ── Client Messages (Frontend -> Backend) ─────────────────────────────────────
class ChatUserMessage(BaseModel):
    """
    Client sends a text message to start a conversation turn.

    Triggers: LLM streaming -> TTS generation -> Viseme generation
    """

    session_id: str | None = Field(
        None, description="Session identifier (optional, server assigns if missing)"
    )
    message_id: str = Field(..., description="Unique message identifier")
    text: str = Field(..., min_length=1, max_length=2000, description="User message text")

    @field_validator("session_id", "message_id")
    @classmethod
    def validate_identifier_format(cls, v: str | None) -> str | None:
        """Validate identifier format."""
        return _normalize_optional_identifier(v)

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

    session_id: str = Field(..., description="Session identifier")
    message_id: str = Field(..., description="Message identifier to abort")

    @field_validator("session_id", "message_id")
    @classmethod
    def validate_identifier_format(cls, v: str) -> str:
        """Validate identifier format."""
        return _normalize_required_identifier(v)


class TTSRequest(BaseModel):
    """
    Client requests TTS generation for specific text.

    Optional: Used for standalone TTS without LLM generation
    """

    session_id: str = Field(..., description="Session identifier")
    message_id: str = Field(..., description="Message identifier")
    text: str = Field(..., min_length=1, max_length=2000, description="Text to synthesize")
    voice: str | None = Field("aria", description="TTS voice identifier")
    rate: str | None = Field("+0%", description="Speech rate adjustment")
    pitch: str | None = Field("+0Hz", description="Pitch adjustment")

    @field_validator("session_id", "message_id")
    @classmethod
    def validate_identifier_format(cls, v: str) -> str:
        """Validate identifier format."""
        return _normalize_required_identifier(v)

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
    emotion: str | None = Field(None, description="Detected emotion from AI response")


class UserMessageEcho(BaseModel):
    """
    Server echoes the user message after persistence for idempotent client reconciliation.
    """

    session_id: str = Field(..., description="Session UUID")
    message_id: str = Field(..., description="Message UUID")
    text: str = Field(..., description="User message text")
    conversation_id: str | None = Field(None, description="Conversation identifier")


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


class AnimationTimelineItem(BaseModel):
    """Single animation segment with frame-range and blending hints."""

    animation: str = Field(..., description="Frontend animation id (e.g., talk6)")
    animation_asset: str = Field(..., description="Source FBX asset stem (e.g., Talk6.1)")
    start_frame: int = Field(..., ge=0)
    end_frame: int = Field(..., ge=0)
    transition_out_frame: int = Field(..., ge=0)
    loop_start_frame: int = Field(..., ge=0)
    loop_end_frame: int = Field(..., ge=0)
    blend: float = Field(..., ge=0.0, le=1.0)
    intent: str = Field(..., description="Detected semantic intent")
    intent_scores: dict[str, float] = Field(
        default_factory=dict,
        description="Intent probability distribution used for selection",
    )
    tone: str = Field(..., description="Detected tone/emotion")
    text: str = Field(..., description="Source text segment")


class AnimationTimeline(BaseModel):
    """Timeline generated by backend animation intelligence engine."""

    session_id: str = Field(..., description="Session UUID")
    message_id: str = Field(..., description="Message UUID")
    timeline: list[AnimationTimelineItem] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)


class AnimationTimelineV2Item(BaseModel):
    """Audio-synchronized animation segment used by timeline v2."""

    start_time: float = Field(..., ge=0.0, description="Segment start in seconds")
    end_time: float = Field(..., ge=0.0, description="Segment end in seconds")
    animation: str = Field(..., description="Frontend animation id (e.g., talk4, idle)")
    animation_asset: str = Field(..., description="Source asset stem (e.g., Talk4.2)")
    blend_weight: float = Field(..., ge=0.0, le=1.0)
    speed: float = Field(..., ge=0.5, le=1.5)
    intensity: float = Field(..., ge=0.0, le=1.0)
    transition_type: Literal["smooth", "emphasis", "pause", "hold"] = Field(
        ..., description="Transition style hint"
    )
    intent: str = Field(..., description="Semantic intent")
    intent_scores: dict[str, float] = Field(default_factory=dict)
    tone: str = Field(..., description="Semantic tone")
    text: str = Field(..., description="Source semantic segment text")
    start_frame: int = Field(..., ge=0)
    end_frame: int = Field(..., ge=0)
    transition_out_frame: int = Field(..., ge=0)
    loop_start_frame: int = Field(..., ge=0)
    loop_end_frame: int = Field(..., ge=0)

    @field_validator("end_time")
    @classmethod
    def validate_end_after_start(cls, v: float, info):
        if "start_time" in info.data and v <= info.data["start_time"]:
            raise ValueError("end_time must be greater than start_time")
        return v


class AnimationTimelineV2(BaseModel):
    """Audio-driven + context-aware animation timeline."""

    session_id: str = Field(..., description="Session UUID")
    message_id: str = Field(..., description="Message UUID")
    timeline: list[AnimationTimelineV2Item] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)


class ErrorMessage(BaseModel):
    """
    Server reports an error to the client.

    Error codes:
    - INVALID_MESSAGE: Message validation failed
    - PIPELINE_ERROR: Error during LLM/TTS/Viseme generation
    - SESSION_ERROR: Session management error
    - TIMEOUT: Operation timed out
    """

    session_id: str | None = Field(None, description="Session UUID (if applicable)")
    message_id: str | None = Field(None, description="Message UUID (if applicable)")
    code: str = Field(..., description="Error code identifier")
    message: str = Field(..., description="Human-readable error message")
    details: dict[str, Any] | None = Field(None, description="Additional error context")


# ── Helper Functions ──────────────────────────────────────────────────────────
def make_chat_delta(session_id: str, message_id: str, delta: str) -> ChatDelta:
    """Create a ChatDelta message."""
    return ChatDelta(session_id=session_id, message_id=message_id, delta=delta)


def make_chat_final(
    session_id: str, message_id: str, text: str, emotion: str | None = None
) -> ChatFinal:
    """Create a ChatFinal message."""
    return ChatFinal(session_id=session_id, message_id=message_id, text=text, emotion=emotion)


def make_user_message_echo(
    session_id: str,
    message_id: str,
    text: str,
    conversation_id: str | None = None,
) -> UserMessageEcho:
    """Create a UserMessageEcho message."""
    return UserMessageEcho(
        session_id=session_id,
        message_id=message_id,
        text=text,
        conversation_id=conversation_id,
    )


def make_pipeline_state(
    session_id: str, state: Literal["idle", "thinking", "speaking", "error"]
) -> PipelineState:
    """Create a PipelineState message."""
    return PipelineState(session_id=session_id, state=state)


def make_tts_ready(session_id: str, message_id: str, audio_url: str, duration_ms: int) -> TTSReady:
    """Create a TTSReady message."""
    audio = AudioData(url=audio_url, mime="audio/mpeg", duration_ms=duration_ms)
    return TTSReady(session_id=session_id, message_id=message_id, audio=audio)


def make_visemes_ready(
    session_id: str, message_id: str, mouth_cues: list[MouthCue]
) -> VisemesReady:
    """Create a VisemesReady message."""
    return VisemesReady(
        session_id=session_id, message_id=message_id, format="mouthCues", mouthCues=mouth_cues
    )


def make_animation_timeline(
    session_id: str,
    message_id: str,
    timeline: list[dict],
    meta: dict[str, Any] | None = None,
) -> AnimationTimeline:
    """Create animation timeline message for frontend playback orchestration."""
    items = [AnimationTimelineItem(**item) for item in timeline]
    return AnimationTimeline(
        session_id=session_id,
        message_id=message_id,
        timeline=items,
        meta=meta or {},
    )


def make_animation_timeline_v2(
    session_id: str,
    message_id: str,
    timeline: list[dict],
    meta: dict[str, Any] | None = None,
) -> AnimationTimelineV2:
    """Create audio-synchronized timeline v2 message."""
    items = [AnimationTimelineV2Item(**item) for item in timeline]
    return AnimationTimelineV2(
        session_id=session_id,
        message_id=message_id,
        timeline=items,
        meta=meta or {},
    )


def make_error(
    code: str,
    message: str,
    session_id: str | None = None,
    message_id: str | None = None,
    details: dict | None = None,
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

    PING = "ping"
    ABORT = "abort"
    VOICE_MODE_STOP = "voice_mode_stop"
    AUDIO_CHUNK = "audio_chunk"


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
