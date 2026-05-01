"""
User domain entity — pure dataclass representation of a user.

Extracted from app.models.user (SQLAlchemy ORM model fields).
This is the domain entity; the ORM model lives in infrastructure/db/models.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class UserEntity:
    """Pure domain representation of a user (no ORM dependency)."""

    id: str
    email: str
    full_name: str
    username: str = ""
    hashed_password: str | None = None
    provider: str = "local"  # local | google
    google_id: str | None = None
    setup_complete: bool = False
    is_active: bool = True
    refresh_token_version: int = 0
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

