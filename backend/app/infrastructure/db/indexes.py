"""
MongoDB index definitions — all indexes in a single place.

Design rules:
- All index creation is idempotent (background=True where supported)
- Unique indexes enforce data constraints at the DB level
- Compound indexes match actual query patterns
- Partial unique indexes used for optional unique fields (e.g. google_id)

Called once on startup from mongodb.init_mongodb().
"""

from __future__ import annotations

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, IndexModel


GOOGLE_ID_INDEX_NAME = "google_id_unique_string"
GOOGLE_ID_PARTIAL_FILTER = {"google_id": {"$type": "string"}}


async def create_all_indexes(db: AsyncIOMotorDatabase) -> None:
    """Create all indexes across all collections. Safe to call on every startup."""
    await _index_users(db)
    await _index_avatars(db)
    await _index_chat_sessions(db)
    await _index_messages(db)
    await _index_documents(db)
    logger.info("MongoDB indexes created / verified")


async def _index_users(db: AsyncIOMotorDatabase) -> None:
    """
    users collection indexes:
    - email: unique (login lookups)
    - google_id: unique partial index for Google OAuth IDs (ignores null/missing values)
    """
    users = db["users"]

    # Remove older google_id unique indexes so null values stop colliding during updates.
    existing_indexes = await users.index_information()
    for index_name, index_spec in existing_indexes.items():
        if index_spec.get("key") == [("google_id", ASCENDING)] and index_spec.get("unique"):
            is_desired_index = (
                index_name == GOOGLE_ID_INDEX_NAME
                and index_spec.get("partialFilterExpression") == GOOGLE_ID_PARTIAL_FILTER
            )
            if is_desired_index:
                continue

            logger.warning(
                f"Dropping obsolete google_id index | name={index_name} | spec={index_spec}"
            )
            await users.drop_index(index_name)

    await users.create_indexes(
        [
            IndexModel([("email", ASCENDING)], unique=True, name="email_unique"),
            IndexModel(
                [("google_id", ASCENDING)],
                unique=True,
                name=GOOGLE_ID_INDEX_NAME,
                partialFilterExpression=GOOGLE_ID_PARTIAL_FILTER,
            ),
        ]
    )


async def _index_avatars(db: AsyncIOMotorDatabase) -> None:
    """
    avatars collection indexes:
    - user_id: unique (one avatar per user, enforced at DB level)
    """
    await db["avatars"].create_indexes(
        [
            IndexModel([("user_id", ASCENDING)], unique=True, name="user_id_unique"),
        ]
    )


async def _index_chat_sessions(db: AsyncIOMotorDatabase) -> None:
    """
    chat_sessions collection indexes:
    - user_id + last_active: session list queries (descending by activity)
    - is_archived: filter active vs archived sessions
    """
    await db["chat_sessions"].create_indexes(
        [
            IndexModel(
                [("user_id", ASCENDING), ("last_active", DESCENDING)],
                name="user_sessions_by_activity",
            ),
            IndexModel([("is_archived", ASCENDING)], name="is_archived"),
        ]
    )


async def _index_messages(db: AsyncIOMotorDatabase) -> None:
    """
    messages collection indexes:
    - session_id + timestamp: message history queries (most common)
    - tts_cache_key: TTS cache lookup (sparse — not all messages have TTS)
    """
    await db["messages"].create_indexes(
        [
            IndexModel(
                [("session_id", ASCENDING), ("timestamp", ASCENDING)],
                name="session_messages_timeline",
            ),
            IndexModel(
                [("tts_cache_key", ASCENDING)],
                sparse=True,
                name="tts_cache_key_sparse",
            ),
        ]
    )


async def _index_documents(db: AsyncIOMotorDatabase) -> None:
    """
    documents collection indexes:
    - user_id + upload_date: document list per user (newest first)
    - status: filter by processing state
    """
    await db["documents"].create_indexes(
        [
            IndexModel(
                [("user_id", ASCENDING), ("upload_date", DESCENDING)],
                name="user_documents_by_date",
            ),
            IndexModel([("status", ASCENDING)], name="document_status"),
        ]
    )
