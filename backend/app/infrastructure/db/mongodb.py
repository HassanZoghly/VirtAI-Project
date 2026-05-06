"""
MongoDB async client — Motor-based connection management.

Provides:
- init_mongodb()  : connect, create indexes, called at startup
- close_mongodb() : clean shutdown
- get_database()  : returns the active AsyncIOMotorDatabase
- Collection accessors used throughout infrastructure

Key design decisions:
- Single Motor client shared across the application (thread-safe)
- All index creation is idempotent (safe to call on every startup)
- No credentials hardcoded — reads from Settings at startup
"""

from __future__ import annotations

from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorDatabase

from app.shared.config import get_settings

_client: AsyncIOMotorClient | None = None
_database: AsyncIOMotorDatabase | None = None


async def init_mongodb() -> None:
    """
    Connect to MongoDB and initialise indexes.
    Called once at application startup (lifespan).
    """
    global _client, _database

    settings = get_settings()
    url_safe = settings.MONGODB_URL.split("@")[-1] if "@" in settings.MONGODB_URL else "redacted"
    logger.info(f"Connecting to MongoDB | url={url_safe} | db={settings.MONGODB_DB_NAME}")

    _client = AsyncIOMotorClient(
        settings.MONGODB_URL,
        serverSelectionTimeoutMS=5000,
    )

    # Ping to verify connectivity early
    await _client.admin.command("ping")
    logger.info("MongoDB connection established")

    _database = _client[settings.MONGODB_DB_NAME]

    # Create all indexes on startup (idempotent)
    from app.infrastructure.db.indexes import create_all_indexes
    await create_all_indexes(_database)

    logger.info(f"MongoDB initialised | db={settings.MONGODB_DB_NAME}")


async def close_mongodb() -> None:
    """Close the Motor client. Called at application shutdown."""
    global _client, _database
    if _client is not None:
        _client.close()
        _client = None
        _database = None
        logger.info("MongoDB connection closed")


def get_database() -> AsyncIOMotorDatabase:
    """
    Return the active database instance.
    Raises RuntimeError if init_mongodb() has not been called.
    """
    if _database is None:
        raise RuntimeError(
            "MongoDB not initialised. "
            "Ensure init_mongodb() is called in the app lifespan."
        )
    return _database


# ── Collection accessors ──────────────────────────────────────────────────────

def users_col() -> AsyncIOMotorCollection:
    return get_database()["users"]


def avatars_col() -> AsyncIOMotorCollection:
    return get_database()["avatars"]


def chat_sessions_col() -> AsyncIOMotorCollection:
    return get_database()["chat_sessions"]


def messages_col() -> AsyncIOMotorCollection:
    return get_database()["messages"]


def documents_col() -> AsyncIOMotorCollection:
    return get_database()["documents"]
