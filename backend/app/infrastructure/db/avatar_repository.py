"""
MongoDB repository for user avatar configurations.

One avatar per user, enforced by a unique index on user_id.
Uses upsert so "create or update" is a single operation.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from bson import ObjectId
from loguru import logger

from app.infrastructure.db.mongodb import avatars_col

Language = Literal["ar", "en"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def get_avatar_by_user(user_id: str) -> dict | None:
    """Fetch the avatar config for a given user."""
    try:
        doc = await avatars_col().find_one({"user_id": ObjectId(user_id)})
    except Exception:
        return None
    return _serialise(doc) if doc else None


async def upsert_avatar(
    user_id: str,
    avatar_url: str = "",
    voice_id: str = "aria",
    language: Language = "en",
    persona_prompt: str = "",
) -> dict:
    """
    Create or update the avatar config for a user.
    The unique index on user_id guarantees one avatar per user.
    """
    result = await avatars_col().find_one_and_update(
        {"user_id": ObjectId(user_id)},
        {
            "$set": {
                "avatar_url": avatar_url,
                "voice_id": voice_id,
                "language": language,
                "persona_prompt": persona_prompt,
                "updated_at": _now(),
            },
            "$setOnInsert": {
                "user_id": ObjectId(user_id),
            },
        },
        upsert=True,
        return_document=True,
    )
    logger.debug(f"Avatar upserted | user={user_id}")
    return _serialise(result)


async def delete_avatar(user_id: str) -> bool:
    """Remove the avatar config for a user. Returns True if deleted."""
    result = await avatars_col().delete_one({"user_id": ObjectId(user_id)})
    return result.deleted_count > 0


def _serialise(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "user_id": str(doc["user_id"]),
        "avatar_url": doc.get("avatar_url", ""),
        "voice_id": doc.get("voice_id", "aria"),
        "language": doc.get("language", "en"),
        "persona_prompt": doc.get("persona_prompt", ""),
        "updated_at": doc.get("updated_at"),
    }
