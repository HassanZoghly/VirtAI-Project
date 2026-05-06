"""
Redis async client — connection lifecycle management.

Single redis.asyncio client instance shared across the application.
Uses hiredis parser for performance where available.

Pattern: init_redis() at startup, close_redis() at shutdown.
get_redis() returns the active client for use in cache modules.
"""

from __future__ import annotations

import redis.asyncio as aioredis
from loguru import logger

from app.shared.config import get_settings

_redis: aioredis.Redis | None = None


async def init_redis() -> None:
    """
    Connect to Redis and verify connectivity.
    Called once at application startup (lifespan).
    """
    global _redis

    settings = get_settings()
    url_safe = settings.REDIS_URL.split("@")[-1] if "@" in settings.REDIS_URL else "redacted"
    logger.info(f"Connecting to Redis | url={url_safe}")

    _redis = aioredis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=False,  # keep bytes; callers encode/decode as needed
        socket_connect_timeout=5,
        socket_timeout=5,
    )

    # Verify connectivity
    await _redis.ping()
    logger.info("Redis connection established")


async def close_redis() -> None:
    """Close Redis connection. Called at application shutdown."""
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None
        logger.info("Redis connection closed")


def get_redis() -> aioredis.Redis:
    """
    Return the active Redis client.
    Raises RuntimeError if init_redis() has not been called.
    """
    if _redis is None:
        raise RuntimeError(
            "Redis not initialised. "
            "Ensure init_redis() is called in the app lifespan."
        )
    return _redis
