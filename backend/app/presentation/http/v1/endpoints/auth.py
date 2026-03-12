"""Authentication API endpoints — login, signup, Google OAuth, token refresh.

Canonical location: app.presentation.http.v1.endpoints.auth
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, Cookie
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.config import get_settings
from app.infrastructure.db.database import get_db
from app.shared.security import (
    create_access_token,
    create_refresh_token,
    verify_token,
)
from app.infrastructure.db.models import User
from app.schemas.auth import (
    GoogleCallbackRequest,
    LoginRequest,
    SignupRequest,
    TokenResponse,
    UserResponse,
)
from app.infrastructure.auth.auth_service import (
    authenticate_user,
    build_google_auth_url,
    exchange_google_code,
    get_or_create_google_user,
    get_user_by_email,
    get_user_by_id,
    register_user,
)

_bearer = HTTPBearer(auto_error=False)


async def _current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = verify_token(creds.credentials, expected_type="access")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await get_user_by_id(db, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


router = APIRouter()

COOKIE_KEY = "refresh_token"
COOKIE_PATH = "/api/v1/auth"
COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days in seconds


def _set_refresh_cookie(response: Response, token: str) -> None:
    secure = get_settings().ENVIRONMENT == "production"
    response.set_cookie(
        key=COOKIE_KEY,
        value=token,
        httponly=True,
        secure=secure,
        samesite="lax",
        path=COOKIE_PATH,
        max_age=COOKIE_MAX_AGE,
    )


def _user_response(user) -> UserResponse:
    return UserResponse(
        id=user.id,
        first_name=user.full_name.split()[0] if user.full_name else "",
        email=user.email,
        is_new_user=not user.setup_complete,
        setup_complete=user.setup_complete,
    )


@router.post("/login")
async def login(
    body: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = await authenticate_user(db, body.email, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    _set_refresh_cookie(response, refresh)
    return {
        "access_token": access,
        "token_type": "bearer",
        "user": _user_response(user).model_dump(by_alias=True),
    }


@router.post("/signup", status_code=201)
async def signup(
    body: SignupRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    existing = await get_user_by_email(db, body.email)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = await register_user(db, body.full_name, body.email, body.password)
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    _set_refresh_cookie(response, refresh)
    return {
        "access_token": access,
        "token_type": "bearer",
        "user": _user_response(user).model_dump(by_alias=True),
    }


@router.get("/me")
async def me(user: User = Depends(_current_user)) -> dict:
    return _user_response(user).model_dump(by_alias=True)


@router.get("/google/url")
async def google_url() -> dict:
    return {"url": build_google_auth_url()}


@router.post("/google/callback")
async def google_callback(
    body: GoogleCallbackRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    google_info = await exchange_google_code(body.code)
    user = await get_or_create_google_user(db, google_info)
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    _set_refresh_cookie(response, refresh)
    return {
        "access_token": access,
        "token_type": "bearer",
        "user": _user_response(user).model_dump(by_alias=True),
    }


@router.post("/refresh")
async def refresh(
    refresh_token: str | None = Cookie(None, alias=COOKIE_KEY),
) -> dict:
    if refresh_token is None:
        raise HTTPException(status_code=401, detail="Missing refresh token")
    payload = verify_token(refresh_token, expected_type="refresh")
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    new_access = create_access_token(payload)
    return {"access_token": new_access, "token_type": "bearer"}


@router.post("/logout")
async def logout(response: Response) -> dict:
    secure = get_settings().ENVIRONMENT == "production"
    response.delete_cookie(
        key=COOKIE_KEY,
        httponly=True,
        secure=secure,
        samesite="lax",
        path=COOKIE_PATH,
    )
    return {"detail": "Logged out"}
