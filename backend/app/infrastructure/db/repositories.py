"""Concrete SQLAlchemy implementation of UserRepositoryPort."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.user.entities import UserEntity
from app.domain.user.ports import UserRepositoryPort
from app.infrastructure.db.models import User


def _to_entity(row: User) -> UserEntity:
    return UserEntity(
        id=row.id,
        email=row.email,
        full_name=row.full_name,
        hashed_password=row.hashed_password,
        provider=row.provider,
        google_id=row.google_id,
        setup_complete=row.setup_complete,
        is_active=row.is_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _to_model(entity: UserEntity) -> User:
    return User(
        id=entity.id,
        email=entity.email,
        full_name=entity.full_name,
        hashed_password=entity.hashed_password,
        provider=entity.provider,
        google_id=entity.google_id,
        setup_complete=entity.setup_complete,
        is_active=entity.is_active,
        created_at=entity.created_at,
        updated_at=entity.updated_at,
    )


class SQLAlchemyUserRepository(UserRepositoryPort):
    """UserRepositoryPort backed by SQLAlchemy + async SQLite."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, user_id: str) -> Optional[UserEntity]:
        result = await self._session.execute(select(User).where(User.id == user_id))
        row = result.scalar_one_or_none()
        return _to_entity(row) if row else None

    async def get_by_email(self, email: str) -> Optional[UserEntity]:
        result = await self._session.execute(select(User).where(User.email == email))
        row = result.scalar_one_or_none()
        return _to_entity(row) if row else None

    async def get_by_google_id(self, google_id: str) -> Optional[UserEntity]:
        result = await self._session.execute(select(User).where(User.google_id == google_id))
        row = result.scalar_one_or_none()
        return _to_entity(row) if row else None

    async def create(self, user: UserEntity) -> UserEntity:
        model = _to_model(user)
        self._session.add(model)
        await self._session.commit()
        await self._session.refresh(model)
        return _to_entity(model)

    async def update(self, user: UserEntity) -> UserEntity:
        result = await self._session.execute(select(User).where(User.id == user.id))
        row = result.scalar_one_or_none()
        if row is None:
            raise ValueError(f"User {user.id} not found")
        row.email = user.email
        row.full_name = user.full_name
        row.hashed_password = user.hashed_password
        row.provider = user.provider
        row.google_id = user.google_id
        row.setup_complete = user.setup_complete
        row.is_active = user.is_active
        await self._session.commit()
        await self._session.refresh(row)
        return _to_entity(row)
