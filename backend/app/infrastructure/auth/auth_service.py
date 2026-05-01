"""
Authentication business-logic: user CRUD, credential verification, Google OAuth.

Rewritten to use MongoDB (Motor) via MongoUserRepository.
All function signatures match the original — only the internal
storage layer changed.
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
from bson import ObjectId

from app.domain.user.entities import UserEntity
from app.infrastructure.db.user_repository import MongoUserRepository
from app.shared.config import get_settings
from app.shared.security import hash_password, verify_password

_user_repository = MongoUserRepository()

def _repo() -> MongoUserRepository:
    """Factory for the user repository (no DI container needed)."""
    return _user_repository


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Local auth helpers
# ---------------------------------------------------------------------------


async def get_user_by_id(user_id: str) -> UserEntity | None:
    return await _repo().get_by_id(user_id)


async def get_user_by_email(email: str) -> UserEntity | None:
    return await _repo().get_by_email(email)


async def set_user_setup_complete(user_id: str, setup_complete: bool) -> UserEntity | None:
    """Update setup completion status for an existing user."""
    repo = _repo()
    user = await repo.get_by_id(user_id)
    if user is None:
        return None

    user.setup_complete = setup_complete
    user.updated_at = _now()
    return await repo.update(user)


async def register_user(
    full_name: str,
    email: str,
    password: str,
    username: str = "",
) -> UserEntity:
    """Create a new local user. Raises ValueError if email already exists."""
    existing = await _repo().get_by_email(email)
    if existing is not None:
        raise ValueError(f"Email already registered: {email}")

    entity = UserEntity(
        id=str(ObjectId()),  # pre-generate MongoDB ObjectId as string
        email=email,
        full_name=full_name,
        username=username or full_name.split()[0].lower(),
        hashed_password=hash_password(password),
        provider="local",
        created_at=_now(),
        updated_at=_now(),
    )
    return await _repo().create(entity)


async def authenticate_user(email: str, password: str) -> UserEntity | None:
    """Verify credentials. Returns UserEntity on success, None on failure."""
    user = await _repo().get_by_email(email)
    if user is None or user.hashed_password is None:
        return None
    if not verify_password(password, user.hashed_password):
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


async def get_or_create_google_user(google_info: dict) -> UserEntity:
    """Find or create a user from Google OAuth info."""
    repo = _repo()
    google_id: str = str(google_info["id"])
    email: str = google_info["email"]
    name: str = google_info.get("name", "")

    # Try by google_id first
    user = await repo.get_by_google_id(google_id)
    if user is not None:
        return user

    # Try by email (link existing local account)
    user = await repo.get_by_email(email)
    if user is not None:
        user.google_id = google_id
        user.provider = "google"
        user.updated_at = _now()
        return await repo.update(user)

    # Brand-new Google user
    entity = UserEntity(
        id=str(ObjectId()),
        email=email,
        full_name=name,
        username=name.split()[0].lower() if name else "user",
        provider="google",
        google_id=google_id,
        created_at=_now(),
        updated_at=_now(),
    )
    return await repo.create(entity)
