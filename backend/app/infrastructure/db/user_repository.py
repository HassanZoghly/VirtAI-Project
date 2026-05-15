"""
MongoDB implementation of UserRepositoryPort.

Maps between domain UserEntity and MongoDB documents.
All methods are async (Motor returns awaitables).

ObjectId is stored as string in UserEntity.id for domain isolation.
"""

from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from loguru import logger

from app.domain.user.entities import AuthProvider, UserEntity
from app.domain.user.ports import UserRepositoryPort
from app.infrastructure.db.mongodb import users_col


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_provider(value: str | AuthProvider | None) -> AuthProvider:
    if isinstance(value, AuthProvider):
        return value
    if not value:
        return AuthProvider.LOCAL
    try:
        return AuthProvider(value)
    except ValueError:
        return AuthProvider.LOCAL


def _doc_to_entity(doc: dict) -> UserEntity:
    """Convert a MongoDB document to UserEntity."""
    provider = _coerce_provider(doc.get("provider"))
    return UserEntity(
        id=str(doc["_id"]),
        email=doc["email"],
        username=doc.get("username"),
        full_name=doc.get("full_name", ""),
        password_hash=doc.get("password_hash"),
        provider=provider,
        google_id=doc.get("google_id"),
        setup_complete=doc.get("setup_complete", False),
        is_active=doc.get("is_active", True),
        created_at=doc.get("created_at", _now()),
        updated_at=doc.get("updated_at", _now()),
    )


def _entity_to_doc(entity: UserEntity) -> dict:
    """Convert a UserEntity to a MongoDB document dict (without _id)."""
    doc = {
        "email": entity.email,
        "username": entity.username or "",
        "full_name": entity.full_name,
        "password_hash": entity.password_hash,
        "provider": entity.provider.value,
        "setup_complete": entity.setup_complete,
        "is_active": entity.is_active,
        "refresh_token_version": entity.refresh_token_version,
        "created_at": entity.created_at,
        "updated_at": entity.updated_at,
    }
    if entity.google_id is not None:
        doc["google_id"] = entity.google_id
    return doc


class MongoUserRepository(UserRepositoryPort):
    """UserRepositoryPort backed by MongoDB via Motor."""

    async def get_by_id(self, user_id: str) -> UserEntity | None:
        try:
            doc = await users_col().find_one({"_id": ObjectId(user_id)})
        except Exception:
            # Invalid ObjectId format
            return None
        return _doc_to_entity(doc) if doc else None

    async def get_by_email(self, email: str) -> UserEntity | None:
        doc = await users_col().find_one({"email": email})
        return _doc_to_entity(doc) if doc else None

    async def get_by_google_id(self, google_id: str) -> UserEntity | None:
        doc = await users_col().find_one({"google_id": google_id})
        return _doc_to_entity(doc) if doc else None

    async def create(self, entity: UserEntity) -> UserEntity:
        doc = _entity_to_doc(entity)
        # Use entity.id as ObjectId if provided and valid, otherwise let MongoDB generate one
        try:
            doc["_id"] = ObjectId(entity.id)
        except Exception:
            doc["_id"] = ObjectId()  # auto-generate

        result = await users_col().insert_one(doc)
        logger.debug(f"User created | id={result.inserted_id}")
        doc["_id"] = result.inserted_id
        return _doc_to_entity(doc)

    async def update(self, entity: UserEntity) -> UserEntity:
        try:
            oid = ObjectId(entity.id)
        except Exception:
            raise ValueError(f"Invalid user id: {entity.id}")

        update_doc = {
            "$set": {
                "email": entity.email,
                "username": entity.username or "",
                "full_name": entity.full_name,
                "password_hash": entity.password_hash,
                "provider": entity.provider.value,
                "setup_complete": entity.setup_complete,
                "is_active": entity.is_active,
                "refresh_token_version": entity.refresh_token_version,
                "updated_at": _now(),
            }
        }
        if entity.google_id is not None:
            update_doc["$set"]["google_id"] = entity.google_id
        result = await users_col().find_one_and_update(
            {"_id": oid},
            update_doc,
            return_document=True,
        )
        if result is None:
            raise ValueError(f"User {entity.id} not found")
        return _doc_to_entity(result)
