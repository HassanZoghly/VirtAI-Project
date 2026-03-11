"""Authentication business-logic: user CRUD, credential verification, Google OAuth."""

from __future__ import annotations

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.config import get_settings
from app.shared.security import hash_password, verify_password
from app.infrastructure.db.models import User


# ---------------------------------------------------------------------------
# Local auth helpers
# ---------------------------------------------------------------------------


async def get_user_by_id(db: AsyncSession, user_id: str) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def register_user(
    db: AsyncSession,
    full_name: str,
    email: str,
    password: str,
) -> User:
    user = User(
        full_name=full_name,
        email=email,
        hashed_password=hash_password(password),
        provider="local",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_user(
    db: AsyncSession,
    email: str,
    password: str,
) -> User | None:
    user = await get_user_by_email(db, email)
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


def build_google_auth_url() -> str:
    settings = get_settings()
    params = (
        f"client_id={settings.GOOGLE_CLIENT_ID}"
        f"&redirect_uri={settings.GOOGLE_REDIRECT_URI}"
        "&response_type=code"
        "&scope=openid%20email%20profile"
        "&access_type=offline"
        "&prompt=consent"
    )
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


async def get_or_create_google_user(
    db: AsyncSession,
    google_info: dict,
) -> User:
    google_id: str = str(google_info["id"])
    email: str = google_info["email"]
    name: str = google_info.get("name", "")

    # Try finding by google_id first, then by email.
    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()
    if user is not None:
        return user

    user = await get_user_by_email(db, email)
    if user is not None:
        # Link existing local account to Google.
        user.google_id = google_id
        user.provider = "google"
        await db.commit()
        await db.refresh(user)
        return user

    # Brand-new Google user.
    user = User(
        full_name=name,
        email=email,
        provider="google",
        google_id=google_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
