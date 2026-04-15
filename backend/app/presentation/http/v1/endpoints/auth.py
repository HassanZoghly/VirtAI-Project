"""Authentication API endpoints — login, signup, Google OAuth, token refresh, logout.

Canonical location: app.presentation.http.v1.endpoints.auth

Changes from original:
- Uses MongoDB-backed auth_service (no SQLAlchemy session injection)
- JWT blacklist checked on every authenticated request via Redis
- Logout blacklists the access token JTI
"""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.shared.config import get_settings
from app.shared.security import (
    create_access_token,
    create_refresh_token,
    extract_jti,
    verify_token,
)
from app.domain.user.entities import UserEntity
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
from app.infrastructure.cache.jwt_blacklist import blacklist_token, is_blacklisted

_bearer = HTTPBearer(auto_error=False)


async def _current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserEntity:
    """Dependency: resolve Bearer token → UserEntity, checking blacklist."""
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    result = verify_token(creds.credentials, expected_type="access")
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id, jti = result

    # Check JWT blacklist (logout invalidation)
    if jti and await is_blacklisted(jti):
        raise HTTPException(status_code=401, detail="Token has been revoked")

    user = await get_user_by_id(user_id)
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


def _user_response(user: UserEntity) -> UserResponse:
    return UserResponse(
        id=user.id,
        first_name=user.full_name.split()[0] if user.full_name else "",
        email=user.email,
        is_new_user=not user.setup_complete,
        setup_complete=user.setup_complete,
    )


@router.post("/login")
async def login(body: LoginRequest, response: Response) -> dict:
    user = await authenticate_user(body.email, body.password)
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
async def signup(body: SignupRequest, response: Response) -> dict:
    existing = await get_user_by_email(body.email)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = await register_user(body.full_name, body.email, body.password)
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    _set_refresh_cookie(response, refresh)
    return {
        "access_token": access,
        "token_type": "bearer",
        "user": _user_response(user).model_dump(by_alias=True),
    }


@router.get("/me")
async def me(user: UserEntity = Depends(_current_user)) -> dict:
    return _user_response(user).model_dump(by_alias=True)


@router.get("/google/url")
async def google_url() -> dict:
    return {"url": build_google_auth_url()}


@router.post("/google/callback")
async def google_callback(body: GoogleCallbackRequest, response: Response) -> dict:
    google_info = await exchange_google_code(body.code)
    user = await get_or_create_google_user(google_info)
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

    result = verify_token(refresh_token, expected_type="refresh")
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    user_id, jti = result

    # Check refresh token blacklist
    if jti and await is_blacklisted(jti):
        raise HTTPException(status_code=401, detail="Refresh token has been revoked")

    new_access = create_access_token(user_id)
    return {"access_token": new_access, "token_type": "bearer"}


@router.post("/logout")
async def logout(
    response: Response,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    refresh_token: str | None = Cookie(None, alias=COOKIE_KEY),
) -> dict:
    """
    Invalidate the session:
    1. Blacklist the access token JTI (if provided)
    2. Blacklist the refresh token JTI (if present in cookie)
    3. Clear the refresh token cookie
    """
    # Blacklist access token
    if creds is not None:
        jti = extract_jti(creds.credentials)
        if jti:
            settings = get_settings()
            await blacklist_token(jti, ttl_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60)

    # Blacklist refresh token
    if refresh_token is not None:
        jti = extract_jti(refresh_token)
        if jti:
            await blacklist_token(jti)  # uses default REDIS_JWT_BLACKLIST_TTL

    secure = get_settings().ENVIRONMENT == "production"
    response.delete_cookie(
        key=COOKIE_KEY,
        httponly=True,
        secure=secure,
        samesite="lax",
        path=COOKIE_PATH,
    )
    return {"detail": "Logged out"}
