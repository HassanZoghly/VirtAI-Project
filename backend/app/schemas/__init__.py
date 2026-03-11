"""
Schemas package – public re-exports for all Pydantic DTOs.

Import from ``app.schemas`` for a flat, convenient namespace:

    from app.schemas import AudioBuffer, LoginRequest, ChatDelta
"""

# ── audio ────────────────────────────────────────────────────
from app.schemas.audio import (  # noqa: F401
    AudioChunk,
    AudioBuffer,
    ASRResponse,
)

# ── auth ─────────────────────────────────────────────────────
from app.schemas.auth import (  # noqa: F401
    LoginRequest,
    SignupRequest,
    GoogleCallbackRequest,
    TokenResponse,
    UserResponse,
)

# ── voice_mode ───────────────────────────────────────────────
from app.schemas.voice_mode import (  # noqa: F401
    AudioChunkMessage,
    VoiceModeStop,
    TranscriptMessage,
    VoiceModeError,
    make_transcript_message,
    make_voice_mode_error,
    make_buffer_overflow_error,
    make_transcription_failed_error,
    make_rate_limit_error,
    make_invalid_audio_format_error,
)

# ── ws_messages (modern protocol) ────────────────────────────
from app.schemas.ws_messages import (  # noqa: F401
    # Envelope / base
    WSMessageEnvelope,
    # Client → Server
    ChatUserMessage,
    ChatAbort,
    TTSRequest,
    # Server → Client (modern)
    ChatDelta,
    ChatFinal,
    PipelineState,
    AudioData,
    TTSReady,
    MouthCue,
    VisemesReady,
    ErrorMessage,
    # Modern factory helpers
    make_chat_delta,
    make_chat_final,
    make_pipeline_state,
    make_tts_ready,
    make_visemes_ready,
    make_error,
    # Legacy enums
    ClientMessageType,
    ServerMessageType,
    AvatarStatus,
    # Legacy models
    ServerMessage,
    VisemeEvent,
    VisemesData,
    # Legacy factory helpers
    make_error_msg,
    make_status_msg,
    make_transcript_msg,
    make_tts_chunk_msg,
    make_visemes_msg,
    make_llm_chunk_msg,
)

__all__ = [
    # audio
    "AudioChunk",
    "AudioBuffer",
    "ASRResponse",
    # auth
    "LoginRequest",
    "SignupRequest",
    "GoogleCallbackRequest",
    "TokenResponse",
    "UserResponse",
    # voice_mode
    "AudioChunkMessage",
    "VoiceModeStop",
    "TranscriptMessage",
    "VoiceModeError",
    "make_transcript_message",
    "make_voice_mode_error",
    "make_buffer_overflow_error",
    "make_transcription_failed_error",
    "make_rate_limit_error",
    "make_invalid_audio_format_error",
    # ws_messages – modern protocol
    "WSMessageEnvelope",
    "ChatUserMessage",
    "ChatAbort",
    "TTSRequest",
    "ChatDelta",
    "ChatFinal",
    "PipelineState",
    "AudioData",
    "TTSReady",
    "MouthCue",
    "VisemesReady",
    "ErrorMessage",
    "make_chat_delta",
    "make_chat_final",
    "make_pipeline_state",
    "make_tts_ready",
    "make_visemes_ready",
    "make_error",
    # ws_messages – legacy
    "ClientMessageType",
    "ServerMessageType",
    "AvatarStatus",
    "ServerMessage",
    "VisemeEvent",
    "VisemesData",
    "make_error_msg",
    "make_status_msg",
    "make_transcript_msg",
    "make_tts_chunk_msg",
    "make_visemes_msg",
    "make_llm_chunk_msg",
]
