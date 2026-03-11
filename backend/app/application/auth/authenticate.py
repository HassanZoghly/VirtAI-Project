"""
Authentication use cases — user registration, login, and Google OAuth.

Depends on UserRepositoryPort (domain port) and shared.security helpers.
Google OAuth token exchange is delegated to infrastructure.
"""

from __future__ import annotations

import uuid
from typing import Optional

from loguru import logger

from app.domain.user.entities import UserEntity
from app.domain.user.ports import UserRepositoryPort
from app.shared.security import hash_password, verify_password


async def register_user(
    repo: UserRepositoryPort,
    full_name: str,
    email: str,
    password: str,
) -> UserEntity:
    """Register a new local user."""
    entity = UserEntity(
        id=str(uuid.uuid4()),
        email=email,
        full_name=full_name,
        hashed_password=hash_password(password),
        provider="local",
    )
    created = await repo.create(entity)
    logger.info(f"User registered | email={email}")
    return created


async def authenticate_user(
    repo: UserRepositoryPort,
    email: str,
    password: str,
) -> Optional[UserEntity]:
    """Verify credentials and return user entity, or None."""
    user = await repo.get_by_email(email)
    if user is None or user.hashed_password is None:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


async def get_or_create_google_user(
    repo: UserRepositoryPort,
    google_id: str,
    email: str,
    name: str,
) -> UserEntity:
    """Find existing Google user or create a new one, linking by google_id or email."""
    # Try google_id first
    user = await repo.get_by_google_id(google_id)
    if user is not None:
        return user

    # Try email — link existing local account
    user = await repo.get_by_email(email)
    if user is not None:
        user.google_id = google_id
        user.provider = "google"
        return await repo.update(user)

    # Brand-new user
    entity = UserEntity(
        id=str(uuid.uuid4()),
        email=email,
        full_name=name,
        provider="google",
        google_id=google_id,
    )
    return await repo.create(entity)
