"""
JWT blacklist using Redis.

When a user logs out or a token is revoked, its JTI (JWT ID)
is stored in Redis for the remaining token lifetime.

On every authenticated request, the token JTI is checked against
this blacklist before trusting the token's claims.

Key: virtai:jwt:blacklist:{jti}    (Redis string, value="1")
TTL: REDIS_JWT_BLACKLIST_TTL seconds (matches refresh token lifetime)

Note:
- We store the JTI, not the full token, to keep Redis memory usage minimal
- Access tokens (short-lived, 30 min) are blacklisted on logout
- Refresh tokens (7 days) use the same TTL as their remaining lifetime
"""

from __future__ import annotations

from loguru import logger

from app.infrastructure.cache.cache_keys import jwt_blacklist_key
from app.infrastructure.cache.redis_client import get_redis
from app.infrastructure.cache.token_validation_cache import (
    cache_token_status,
    get_token_status,
    invalidate_token_status,
)
from app.shared.config import get_settings


async def blacklist_token(jti: str, ttl_seconds: int | None = None) -> None:
    """
    Add a token JTI to the blacklist.

    Args:
        jti        : JWT ID claim from the token
        ttl_seconds: how long to keep the blacklist entry.
                     Defaults to REDIS_JWT_BLACKLIST_TTL.
    """
    try:
        settings = get_settings()
        ttl = ttl_seconds if ttl_seconds is not None else settings.REDIS_JWT_BLACKLIST_TTL
        key = jwt_blacklist_key(jti)
        await get_redis().setex(key, ttl, "1")
        await cache_token_status(jti, is_revoked=True, ttl_seconds=min(ttl, 300))
        logger.debug(f"[JWTBlacklist] Token blacklisted | jti={jti[:8]}... | ttl={ttl}s")
    except Exception as e:
        logger.error(f"[JWTBlacklist] blacklist_token failed | jti={jti[:8]}... | {e}")


async def is_blacklisted(jti: str) -> bool:
    """
    Check whether a token JTI has been blacklisted.

    Returns:
        True  → token is blacklisted (reject request)
        False → token is valid, or Redis error (fail open to avoid locking users out)
    """
    try:
        cached = await get_token_status(jti)
        if cached is not None:
            logger.debug(f"[JWTBlacklist] cache_hit | jti={jti[:8]}... | revoked={cached}")
            return cached

        logger.debug(f"[JWTBlacklist] cache_miss | jti={jti[:8]}...")
        key = jwt_blacklist_key(jti)
        exists = await get_redis().exists(key)
        revoked = bool(exists)
        await cache_token_status(jti, is_revoked=revoked)
        return revoked
    except Exception as e:
        # Fail open — prefer availability over strict security during Redis outages.
        # Log at ERROR level so ops teams are alerted.
        logger.error(f"[JWTBlacklist] is_blacklisted check failed (failing open): {e}")
        return False


async def clear_blacklist_cache(jti: str) -> None:
    """Clear short-lived token validation cache for a JTI."""
    await invalidate_token_status(jti)
