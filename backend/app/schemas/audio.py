"""
Audio-related Pydantic schemas
used across WebSocket messages and API responses.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class AudioChunk(BaseModel):
    """A single audio chunk received from the frontend via WebSocket."""

    data: bytes
    index: int = 0
    format: str = "webm"

    @field_validator("format")
    def validate_format(cls, v: str) -> str:
        """Normalize format to lowercase and remove leading dot."""
        return v.lower().lstrip(".")


class AudioBuffer(BaseModel):
    """Accumulated audio chunks ready for ASR."""

    chunks: list[bytes] = Field(default_factory=list)
    format: str = "webm"
    total_size: int = 0

    @field_validator("format")
    def validate_format(cls, v: str) -> str:
        return v.lower().lstrip(".")

    def add_chunk(self, chunk: bytes) -> None:
        self.chunks.append(chunk)
        self.total_size += len(chunk)

    def get_combined(self) -> bytes:
        return b"".join(self.chunks)

    def clear(self) -> None:
        self.chunks.clear()
        self.total_size = 0

    @property
    def is_empty(self) -> bool:
        return len(self.chunks) == 0

    @property
    def chunk_count(self) -> int:
        return len(self.chunks)


class ASRResponse(BaseModel):
    """Schema for ASR result sent back to frontend via WebSocket."""

    transcript: str
    language: str = "en"
    confidence: float = Field(ge=0.0, le=1.0, default=1.0)
    duration_ms: float = 0.0
    word_count: int = 0
