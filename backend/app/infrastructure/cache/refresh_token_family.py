"""Refresh token family tracking and replay detection."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from loguru import logger

from app.infrastructure.cache.cache_keys import (
    auth_refresh_active_jti_key,
    auth_refresh_consumed_jti_key,
    auth_refresh_family_revoked_key,
    auth_refresh_key,
    auth_refresh_reuse_incident_key,
    auth_refresh_rotation_lock_key,
    auth_refresh_user_families_key,
)
from app.infrastructure.cache.redis_client import get_redis
from app.shared.config import get_settings


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def acquire_refresh_rotation_lock(user_id: str, family_id: str) -> str | None:
    settings = get_settings()
    redis = get_redis()
    token = f"{user_id}:{family_id}:{datetime.now(timezone.utc).timestamp()}"
    acquired = await redis.set(
        auth_refresh_rotation_lock_key(user_id, family_id),
        token,
        ex=settings.REFRESH_ROTATION_LOCK_SECONDS,
        nx=True,
    )
    return token if acquired else None


async def release_refresh_rotation_lock(user_id: str, family_id: str, token: str) -> None:
    redis = get_redis()
    key = auth_refresh_rotation_lock_key(user_id, family_id)
    script = """
    if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
    end
    return 0
    """
    await redis.eval(script, 1, key, token)


async def store_initial_refresh_token(
    user_id: str,
    family_id: str,
    refresh_token: str,
    refresh_jti: str,
    ttl_seconds: int,
) -> None:
    redis = get_redis()
    pipe = redis.pipeline()
    pipe.setex(auth_refresh_key(user_id, family_id), ttl_seconds, refresh_token)
    pipe.setex(auth_refresh_active_jti_key(user_id, family_id), ttl_seconds, refresh_jti)
    pipe.sadd(auth_refresh_user_families_key(user_id), family_id)
    pipe.expire(auth_refresh_user_families_key(user_id), ttl_seconds)
    pipe.delete(auth_refresh_family_revoked_key(user_id, family_id))
    await pipe.execute()


async def mark_refresh_rotated(
    user_id: str,
    family_id: str,
    old_jti: str,
    new_jti: str,
    new_refresh_token: str,
    ttl_seconds: int,
) -> None:
    redis = get_redis()
    consumed_payload = json.dumps(
        {
            "user_id": user_id,
            "rotated_at": _now_iso(),
            "replaced_by_jti": new_jti,
        }
    )
    pipe = redis.pipeline()
    pipe.setex(auth_refresh_consumed_jti_key(old_jti), ttl_seconds, consumed_payload)
    pipe.setex(auth_refresh_key(user_id, family_id), ttl_seconds, new_refresh_token)
    pipe.setex(auth_refresh_active_jti_key(user_id, family_id), ttl_seconds, new_jti)
    pipe.sadd(auth_refresh_user_families_key(user_id), family_id)
    pipe.expire(auth_refresh_user_families_key(user_id), ttl_seconds)
    await pipe.execute()


async def is_refresh_jti_consumed(jti: str) -> bool:
    return bool(await get_redis().exists(auth_refresh_consumed_jti_key(jti)))


async def is_refresh_family_revoked(user_id: str, family_id: str) -> bool:
    return bool(await get_redis().exists(auth_refresh_family_revoked_key(user_id, family_id)))


async def revoke_refresh_family(
    user_id: str, family_id: str, *, reason: str, replay_jti: str | None = None
) -> None:
    settings = get_settings()
    ttl_seconds = settings.REFRESH_REUSE_INCIDENT_TTL_DAYS * 24 * 60 * 60
    redis = get_redis()
    pipe = redis.pipeline()
    pipe.delete(auth_refresh_key(user_id, family_id))
    pipe.delete(auth_refresh_active_jti_key(user_id, family_id))
    pipe.setex(
        auth_refresh_family_revoked_key(user_id, family_id),
        ttl_seconds,
        json.dumps({"reason": reason, "revoked_at": _now_iso(), "replay_jti": replay_jti}),
    )
    if replay_jti:
        pipe.hset(
            auth_refresh_reuse_incident_key(user_id, replay_jti),
            mapping={
                "user_id": user_id,
                "jti": replay_jti,
                "reason": reason,
                "detected_at": _now_iso(),
            },
        )
        pipe.expire(auth_refresh_reuse_incident_key(user_id, replay_jti), ttl_seconds)
    await pipe.execute()
    logger.warning(
        {
            "event": "refresh_family_revoked",
            "user_id": user_id,
            "family_id": family_id,
            "reason": reason,
            "replay_jti_prefix": replay_jti[:8] if replay_jti else None,
        }
    )


async def revoke_all_refresh_families(
    user_id: str, *, reason: str, replay_jti: str | None = None
) -> None:
    redis = get_redis()
    raw_families = await redis.smembers(auth_refresh_user_families_key(user_id))
    families = [
        item.decode("utf-8") if isinstance(item, bytes) else str(item) for item in raw_families
    ]
    if not families:
        return
    for family_id in families:
        await revoke_refresh_family(user_id, family_id, reason=reason, replay_jti=replay_jti)
