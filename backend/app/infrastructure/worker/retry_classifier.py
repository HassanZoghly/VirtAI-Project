import asyncpg
import redis.asyncio as redis

from app.domain.rag.stage_machine import InvalidStageTransition
from app.shared.errors import (
    ChunkLimitExceeded,
    EmptyDocumentError,
    UnsupportedFileType,
    VectorDimensionMismatch,
)

RETRYABLE_TYPES = (
    ConnectionError,
    TimeoutError,
    OSError,
    asyncpg.TooManyConnectionsError,
    redis.ConnectionError,
)

NON_RETRYABLE_TYPES = (
    UnicodeDecodeError,
    EmptyDocumentError,
    UnsupportedFileType,
    ChunkLimitExceeded,
    VectorDimensionMismatch,
    InvalidStageTransition,
)


def classify(exc: Exception) -> tuple[bool, str]:
    if isinstance(exc, RETRYABLE_TYPES):
        return True, type(exc).__name__
    if isinstance(exc, NON_RETRYABLE_TYPES):
        return False, type(exc).__name__
    return True, f"unknown:{type(exc).__name__}"
