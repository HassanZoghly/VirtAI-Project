"""Backward-compat shim - canonical source is app.infrastructure.asr.groq_whisper."""
from app.infrastructure.asr.groq_whisper import (  # noqa: F401
    GroqWhisperASR,
    validate_audio_size,
)
