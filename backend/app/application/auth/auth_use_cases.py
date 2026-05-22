"""
Authentication use cases: user CRUD, credential verification, Google OAuth.

All persistence is done through SQLAlchemy async repositories.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

import httpx
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.user.entities import AuthProvider, UserEntity
from app.infrastructure.db.repositories.user_repository import UserRepository
from app.shared.config import get_settings
from app.shared.security import hash_password, verify_password


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Local auth helpers
# ---------------------------------------------------------------------------


async def get_user_by_id(db: AsyncSession, user_id: UUID) -> UserEntity | None:
    repo = UserRepository(db)
    return await repo.get_by_id(user_id)


async def get_user_by_email(db: AsyncSession, email: str) -> UserEntity | None:
    repo = UserRepository(db)
    return await repo.get_by_email(email)


async def set_user_setup_complete(
    db: AsyncSession, user_id: UUID, setup_complete: bool
) -> UserEntity | None:
    """Update setup completion status for an existing user."""
    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if user is None:
        return None

    user.setup_complete = setup_complete
    user.updated_at = _now()
    return await repo.update(user)


async def register_user(
    db: AsyncSession, full_name: str, email: str, password: str, username: str | None = None
) -> UserEntity:
    """Create a new local user. Raises ValueError if email already exists."""
    repo = UserRepository(db)
    existing = await repo.get_by_email(email)
    if existing is not None:
        raise ValueError(f"Email already registered: {email}")

    entity = UserEntity(
        id=uuid4(),
        email=email,
        full_name=full_name,
        username=username or full_name.split()[0].lower(),
        password_hash=hash_password(password),
        provider=AuthProvider.LOCAL,
        created_at=_now(),
        updated_at=_now(),
    )
    return await repo.create(entity)


async def authenticate_user(db: AsyncSession, email: str, password: str) -> UserEntity | None:
    """Verify credentials. Returns UserEntity on success, None on failure."""
    repo = UserRepository(db)
    user = await repo.get_by_email(email)
    if user is None or user.password_hash is None:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


# ---------------------------------------------------------------------------
# Google OAuth helpers
# ---------------------------------------------------------------------------

_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


def build_google_auth_url(state: str = "") -> str:
    settings = get_settings()
    params = (
        f"client_id={settings.GOOGLE_CLIENT_ID}"
        f"&redirect_uri={settings.GOOGLE_REDIRECT_URI}"
        "&response_type=code"
        "&scope=openid%20email%20profile"
        "&access_type=offline"
        "&prompt=consent"
    )
    if state:
        params += f"&state={state}"
    return f"https://accounts.google.com/o/oauth2/v2/auth?{params}"


async def exchange_google_code(code: str) -> dict:
    """Exchange the Google authorisation code for user info."""
    settings = get_settings()
    async with httpx.AsyncClient(timeout=10) as client:
        token_resp = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        token_resp.raise_for_status()
        access_token = token_resp.json()["access_token"]

        info_resp = await client.get(
            _GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        info_resp.raise_for_status()
        return info_resp.json()


async def get_or_create_google_user(db: AsyncSession, google_info: dict) -> UserEntity:
    """Find or create a user from Google OAuth info."""
    repo = UserRepository(db)
    google_id: str = str(google_info["id"])
    email: str = google_info["email"]
    name: str = google_info.get("name", "")

    # Try by google_id first
    user = await repo.get_by_google_id(google_id)
    if user is not None:
        return user

    # Try by email second
    user = await repo.get_by_email(email)
    if user is not None:
        if not user.google_id:
            user.google_id = google_id
            user.provider = AuthProvider.GOOGLE
            user.updated_at = _now()
            user = await repo.update(user)
        return user

    # Create new user atomically
    entity = UserEntity(
        id=uuid4(),
        email=email,
        full_name=name,
        username=name.split()[0].lower() + str(uuid4())[:4] if name else f"user_{uuid4().hex[:8]}",
        password_hash=None,
        provider=AuthProvider.GOOGLE,
        google_id=google_id,
        created_at=_now(),
        updated_at=_now(),
    )

    try:
        return await repo.create(entity)
    except IntegrityError:
        # Created concurrently — rollback and re-fetch
        await db.rollback()
        existing = await repo.get_by_email(email)
        if existing is not None:
            return existing
        raise


async def rotate_refresh_token_version(
    db: AsyncSession, user_id: UUID, expected_version: int
) -> UserEntity | None:
    repo = UserRepository(db)
    return await repo.increment_refresh_token_version(user_id, expected_version)


async def revoke_user_token_version(db: AsyncSession, user_id: UUID) -> UserEntity | None:
    """Force all existing access and refresh tokens for a user to become stale."""
    repo = UserRepository(db)
    return await repo.force_increment_refresh_token_version(user_id)
