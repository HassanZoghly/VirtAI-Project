"""
Audio validation and preprocessing before sending to ASR.
"""

from __future__ import annotations

from loguru import logger

from app.core.errors import AudioException

# ── Constants ─────────────────────────────────────────────────────────────────
MAX_AUDIO_SIZE_BYTES = 24 * 1024 * 1024  # 24 MB
MIN_AUDIO_SIZE_BYTES = 1024  # 1 KB
MAX_AUDIO_DURATION_SEC = 120  # 2 minutes max

SUPPORTED_FORMATS = {"webm", "wav", "mp3", "mp4", "m4a", "mpeg", "mpga", "ogg"}

# WebM magic bytes signature
WEBM_MAGIC = b"\x1a\x45\xdf\xa3"

# WAV magic bytes signature
WAV_MAGIC = b"RIFF"

# MP3 magic bytes signatures
MP3_MAGIC_1 = b"\xff\xfb"
MP3_MAGIC_2 = b"\xff\xf3"
MP3_MAGIC_3 = b"ID3"


# ── Validators ────────────────────────────────────────────────────────────────
def validate_audio_size(audio_bytes: bytes) -> None:
    """Raises AudioException if audio size is out of acceptable range."""
    size = len(audio_bytes)
    if size < MIN_AUDIO_SIZE_BYTES:
        raise AudioException(
            f"Audio too small ({size} bytes). " f"Minimum is {MIN_AUDIO_SIZE_BYTES} bytes."
        )
    if size > MAX_AUDIO_SIZE_BYTES:
        raise AudioException(
            f"Audio too large ({size:,} bytes). " f"Maximum is {MAX_AUDIO_SIZE_BYTES:,} bytes."
        )


def validate_audio_format(audio_format: str) -> str:
    """
    Validates and normalizes the audio format string.
    Returns the normalized format string.
    """
    fmt = audio_format.lower().lstrip(".")

    if fmt not in SUPPORTED_FORMATS:
        raise AudioException(
            f"Unsupported audio format: '{fmt}'. "
            f"Supported: {', '.join(sorted(SUPPORTED_FORMATS))}"
        )

    return fmt


def detect_audio_format(audio_bytes: bytes) -> str:
    """
    Detects audio format from magic bytes.
    Falls back to 'webm' if unknown (most common from browser MediaRecorder).
    """
    if not audio_bytes:
        return "webm"

    header = audio_bytes[:4]

    if header == WEBM_MAGIC:
        return "webm"

    if header[:3] == WAV_MAGIC[:3]:
        return "wav"

    if header[:2] in (MP3_MAGIC_1, MP3_MAGIC_2) or header[:3] == MP3_MAGIC_3:
        return "mp3"

    # Default → browser MediaRecorder output is almost always WebM
    logger.debug(f"Unknown audio format, defaulting to webm | header={header.hex()}")
    return "webm"


def validate_audio(audio_bytes: bytes, audio_format: str = "webm") -> str:
    """
    Full validation pipeline.
    Returns the normalized audio format.

    Steps:
        1. Check size
        2. Validate format string
        3. Auto-detect format from magic bytes if needed
    """
    # 1. Size check
    validate_audio_size(audio_bytes)

    # 2. Format validation
    fmt = validate_audio_format(audio_format)

    # 3. Auto-detect if format seems wrong
    detected = detect_audio_format(audio_bytes)
    if detected != fmt:
        logger.warning(
            f"Format mismatch | declared={fmt} | detected={detected} "
            f"| using detected={detected}"
        )
        fmt = detected

    logger.debug(f"Audio validated | size={len(audio_bytes):,}B | format={fmt}")
    return fmt
