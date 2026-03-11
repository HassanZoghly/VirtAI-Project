"""
User domain entity — pure dataclass representation of a user.

Extracted from app.models.user (SQLAlchemy ORM model fields).
This is the domain entity; the ORM model lives in infrastructure/db/models.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


@dataclass
class UserEntity:
    """Pure domain representation of a user (no ORM dependency)."""

    id: str
    email: str
    full_name: str
    hashed_password: Optional[str] = None
    provider: str = "local"  # local | google
    google_id: Optional[str] = None
    setup_complete: bool = False
    is_active: bool = True
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
