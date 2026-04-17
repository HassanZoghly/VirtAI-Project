"""
Redis key naming conventions — single source of truth.

All Redis keys used across the application are defined here.
This prevents key collisions and makes TTL/scope reasoning clear.

Key format: virtai:{namespace}:{identifier}

Namespaces:
  chat:ctx    — active chat context (last 50 messages per session)
  tts         — synthesised TTS audio cache
  llm         — LLM completion cache
  jwt         — JWT blacklist for invalidated tokens
  rate        — rate limiting counters
  ws          — WebSocket session metadata
"""

from __future__ import annotations

import hashlib


def chat_context_key(session_id: str) -> str:
    """Redis list key for active chat context (last 50 messages)."""
    return f"virtai:chat:ctx:{session_id}"


def tts_cache_key(text: str, voice: str) -> str:
    """Redis string key for cached TTS audio bytes."""
    payload = f"{voice}|{text}"
    digest = hashlib.sha256(payload.encode()).hexdigest()[:32]
    return f"virtai:tts:cache:{digest}"


def llm_cache_key(prompt_hash: str) -> str:
    """Redis string key for cached LLM completions."""
    return f"virtai:llm:cache:{prompt_hash}"


def jwt_blacklist_key(jti: str) -> str:
    """Redis string key for blacklisted JWT token IDs."""
    return f"virtai:jwt:blacklist:{jti}"


def rate_limit_key(identifier: str, window: int) -> str:
    """
    Redis sorted-set key for sliding window rate limiting.

    Args:
        identifier: user_id or IP address
        window    : rate limit window in seconds (used to namespace windows)
    """
    return f"virtai:rate:{identifier}:{window}"


def ws_session_key(session_id: str) -> str:
    """Redis hash key for WebSocket session metadata."""
    return f"virtai:ws:session:{session_id}"


def auth_session_key(user_id: str) -> str:
    """Redis hash key for cached authenticated user profile."""
    return f"virtai:auth:session:{user_id}"


def token_validation_key(jti: str) -> str:
    """Redis string key for cached JWT validation status."""
    return f"virtai:auth:token:{jti}"
