"""
Redis-backed chat context cache.

Stores the last N messages per session as a Redis List of JSON strings.
This reduces MongoDB reads for active conversations.
MongoDB remains the source of truth — Redis is a fast read-through cache.

Flow:
  get_context()     → Redis HIT → return messages
                    → Redis MISS → rebuild from MongoDB → return messages
  push_message()    → append to Redis list + trim to MAX_MESSAGES
  invalidate()      → delete context key (e.g. session ended)

Key: virtai:chat:ctx:{session_id}   (Redis List, JSON strings)
TTL: REDIS_CHAT_CONTEXT_TTL seconds (refreshed on each push)
"""

from __future__ import annotations

import json
from typing import Optional

from loguru import logger

from app.infrastructure.cache.cache_keys import chat_context_key
from app.infrastructure.cache.redis_client import get_redis
from app.shared.config import get_settings

# Maximum messages stored per session in Redis
MAX_MESSAGES = 50


async def get_context(session_id: str) -> list[dict]:
    """
    Return the last MAX_MESSAGES messages for a session.

    Returns an empty list if Redis is unavailable (graceful degradation).
    Does NOT trigger a MongoDB rebuild — call rebuild_context() explicitly
    when you need guaranteed context on a cache miss.
    """
    try:
        redis = get_redis()
        key = chat_context_key(session_id)
        raw_messages = await redis.lrange(key, 0, -1)
        return [json.loads(m) for m in raw_messages]
    except Exception as e:
        logger.warning(f"[ChatContextCache] get_context failed | session={session_id} | {e}")
        return []


async def get_or_rebuild_context(session_id: str) -> list[dict]:
    """
    Get context from Redis, rebuilding from MongoDB if the key is missing or expired.

    This is the preferred method for the pipeline — it guarantees fresh context
    on a cache miss without failing the request.
    """
    messages = await get_context(session_id)
    if not messages:
        logger.info(f"[ChatContextCache] Cache miss — rebuilding | session={session_id}")
        messages = await rebuild_context(session_id)
    return messages


async def push_message(
    session_id: str,
    role: str,
    content: str,
    extra: Optional[dict] = None,
) -> None:
    """
    Append a message to the context list and trim to MAX_MESSAGES.
    Refreshes TTL on every write.

    Args:
        session_id: active session id
        role      : "user" or "assistant"
        content   : message text
        extra     : optional extra fields (input_type, tts_cache_key, etc.)
    """
    try:
        settings = get_settings()
        redis = get_redis()
        key = chat_context_key(session_id)

        message = {"role": role, "content": content}
        if extra:
            message.update(extra)

        pipe = redis.pipeline()
        pipe.rpush(key, json.dumps(message))
        pipe.ltrim(key, -MAX_MESSAGES, -1)           # keep last N
        pipe.expire(key, settings.REDIS_CHAT_CONTEXT_TTL)  # refresh TTL
        await pipe.execute()
    except Exception as e:
        logger.warning(f"[ChatContextCache] push_message failed | session={session_id} | {e}")


async def rebuild_context(session_id: str) -> list[dict]:
    """
    Fetch the last MAX_MESSAGES messages from MongoDB and repopulate Redis.

    Called on a cache miss. Returns the messages fetched.
    Fails gracefully if MongoDB is also unreachable.
    """
    try:
        from app.infrastructure.db.chat_repository import get_session_messages

        messages = await get_session_messages(session_id, limit=MAX_MESSAGES)
        if not messages:
            return []

        settings = get_settings()
        redis = get_redis()
        key = chat_context_key(session_id)

        # Rebuild atomically
        pipe = redis.pipeline()
        pipe.delete(key)
        for msg in messages:
            pipe.rpush(key, json.dumps({"role": msg["role"], "content": msg["content"]}))
        pipe.expire(key, settings.REDIS_CHAT_CONTEXT_TTL)
        await pipe.execute()

        logger.info(
            f"[ChatContextCache] Rebuilt from MongoDB | session={session_id} | count={len(messages)}"
        )
        return [{"role": m["role"], "content": m["content"]} for m in messages]

    except Exception as e:
        logger.error(f"[ChatContextCache] rebuild_context failed | session={session_id} | {e}")
        return []


async def invalidate(session_id: str) -> None:
    """Delete the context key for a session (e.g. on session end)."""
    try:
        await get_redis().delete(chat_context_key(session_id))
        logger.debug(f"[ChatContextCache] Context invalidated | session={session_id}")
    except Exception as e:
        logger.warning(f"[ChatContextCache] invalidate failed | session={session_id} | {e}")
