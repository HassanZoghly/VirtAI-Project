"""
User domain ports — abstract interface for user persistence.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from app.domain.user.entities import UserEntity


class UserRepositoryPort(ABC):
    """Abstract interface for user storage operations."""

    @abstractmethod
    async def get_by_id(self, user_id: str) -> Optional[UserEntity]: ...

    @abstractmethod
    async def get_by_email(self, email: str) -> Optional[UserEntity]: ...

    @abstractmethod
    async def get_by_google_id(self, google_id: str) -> Optional[UserEntity]: ...

    @abstractmethod
    async def create(self, user: UserEntity) -> UserEntity: ...

    @abstractmethod
    async def update(self, user: UserEntity) -> UserEntity: ...
