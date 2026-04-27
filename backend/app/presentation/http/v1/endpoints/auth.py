"""Authentication API endpoints — login, signup, Google OAuth, token refresh, logout.

Canonical location: app.presentation.http.v1.endpoints.auth

Changes from original:
- Uses MongoDB-backed auth_service (no SQLAlchemy session injection)
- JWT blacklist checked on every authenticated request via Redis
- Logout blacklists the access token JTI
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.domain.user.entities import UserEntity
from app.infrastructure.auth.auth_service import (
    authenticate_user,
    build_google_auth_url,
    exchange_google_code,
    get_or_create_google_user,
    get_user_by_email,
    get_user_by_id,
    register_user,
    set_user_setup_complete,
)
from app.infrastructure.cache.auth_session_cache import (
    cache_auth_session,
    get_cached_auth_session,
    invalidate_auth_session,
)
from app.infrastructure.cache.cache_keys import auth_refresh_key
from app.infrastructure.cache.jwt_blacklist import blacklist_token, is_blacklisted
from app.infrastructure.cache.rate_limiter import check_rate_limit
from app.infrastructure.cache.redis_client import get_redis
from app.schemas.auth import (
    GoogleCallbackRequest,
    LoginRequest,
    SetupStatusRequest,
    SignupRequest,
    UserResponse,
)
from app.shared.config import get_settings
from app.shared.security import (
    create_access_token,
    create_refresh_token,
    extract_jti,
    extract_user_id,
    verify_token,
)

_bearer = HTTPBearer(auto_error=False)


def _extract_client_ip(request: Request) -> str:
    settings = get_settings()
    if settings.TRUST_PROXY_HEADERS:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        if forwarded_for:
            first_hop = forwarded_for.split(",")[0].strip()
            if first_hop:
                return first_hop
    return request.client.host if request.client else "unknown"


def _serialize_user_for_cache(user: UserEntity) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "username": user.username,
        "provider": user.provider,
        "google_id": user.google_id,
        "setup_complete": user.setup_complete,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat(),
        "updated_at": user.updated_at.isoformat(),
    }


def _deserialize_cached_user(data: dict) -> UserEntity:
    def _parse_dt(raw: str | None) -> datetime:
        if not raw:
            return datetime.now(timezone.utc)
        try:
            return datetime.fromisoformat(raw)
        except Exception:
            return datetime.now(timezone.utc)

    return UserEntity(
        id=data["id"],
        email=data["email"],
        full_name=data.get("full_name", ""),
        username=data.get("username", ""),
        hashed_password=None,
        provider=data.get("provider", "local"),
        google_id=data.get("google_id"),
        setup_complete=data.get("setup_complete", False),
        is_active=data.get("is_active", True),
        created_at=_parse_dt(data.get("created_at")),
        updated_at=_parse_dt(data.get("updated_at")),
    )


async def _assert_rate_limit(request: Request, scope: str) -> None:
    settings = get_settings()
    client_ip = _extract_client_ip(request)
    identifier = f"auth:{scope}:{client_ip}"
    allowed = await check_rate_limit(
        identifier=identifier,
        limit=settings.RATE_LIMIT_REQUESTS,
        window=settings.RATE_LIMIT_WINDOW,
    )
    if not allowed:
        raise HTTPException(status_code=429, detail="Too many requests")


async def _current_user(
    request: Request,
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

    cached = await get_cached_auth_session(user_id)
    if cached is not None:
        user = _deserialize_cached_user(cached)
        if not user.is_active:
            raise HTTPException(status_code=403, detail="User account is inactive")
        return user

    user = await get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    await cache_auth_session(user_id, _serialize_user_for_cache(user))
    return user


router = APIRouter()

COOKIE_KEY = "refresh_token"
COOKIE_PATH = "/api/v1/auth"


def _refresh_cookie_max_age() -> int:
    settings = get_settings()
    return settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60


def _refresh_cookie_policy() -> tuple[bool, str]:
    # Since frontend and backend use a proxy, they are same-origin from the browser's perspective.
    # SameSite=lax and Secure=False guarantees the cookie is sent correctly in local dev and Docker.
    return False, "lax"


def _set_refresh_cookie(response: Response, token: str) -> None:
    secure, same_site = _refresh_cookie_policy()
    response.set_cookie(
        key=COOKIE_KEY,
        value=token,
        httponly=True,
        secure=secure,
        samesite=same_site,
        path=COOKIE_PATH,
        max_age=_refresh_cookie_max_age(),
    )


def _first_name_from_full_name(full_name: str) -> str:
    stripped = full_name.strip()
    if not stripped:
        return ""
    parts = stripped.split()
    return parts[0] if parts else ""


def _user_response(user: UserEntity) -> UserResponse:
    return UserResponse(
        id=user.id,
        first_name=_first_name_from_full_name(user.full_name),
        email=user.email,
        is_new_user=not user.setup_complete,
        setup_complete=user.setup_complete,
    )


@router.post("/login")
async def login(body: LoginRequest, response: Response, request: Request) -> dict:
    await _assert_rate_limit(request, "login")
    user = await authenticate_user(body.email, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    await get_redis().setex(auth_refresh_key(user.id), _refresh_cookie_max_age(), refresh)
    await cache_auth_session(user.id, _serialize_user_for_cache(user))
    _set_refresh_cookie(response, refresh)
    return {
        "access_token": access,
        "token_type": "bearer",
        "user": _user_response(user).model_dump(by_alias=True),
    }


@router.post("/signup", status_code=201)
async def signup(body: SignupRequest, response: Response, request: Request) -> dict:
    await _assert_rate_limit(request, "signup")
    existing = await get_user_by_email(body.email)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = await register_user(body.full_name, body.email, body.password)
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    await get_redis().setex(auth_refresh_key(user.id), _refresh_cookie_max_age(), refresh)
    await cache_auth_session(user.id, _serialize_user_for_cache(user))
    _set_refresh_cookie(response, refresh)
    return {
        "access_token": access,
        "token_type": "bearer",
        "user": _user_response(user).model_dump(by_alias=True),
    }


@router.get("/me")
async def me(user: UserEntity = Depends(_current_user)) -> dict:
    return _user_response(user).model_dump(by_alias=True)


@router.patch("/me/setup")
async def update_setup_status(
    body: SetupStatusRequest,
    user: UserEntity = Depends(_current_user),
) -> dict:
    updated = await set_user_setup_complete(user.id, body.setup_complete)
    if updated is None:
        raise HTTPException(status_code=404, detail="User not found")

    await invalidate_auth_session(user.id)
    await cache_auth_session(updated.id, _serialize_user_for_cache(updated))
    return _user_response(updated).model_dump(by_alias=True)


@router.get("/google/url")
async def google_url() -> dict:
    return {"url": build_google_auth_url()}


@router.post("/google/callback")
async def google_callback(
    body: GoogleCallbackRequest, response: Response, request: Request
) -> dict:
    await _assert_rate_limit(request, "google_callback")
    google_info = await exchange_google_code(body.code)
    user = await get_or_create_google_user(google_info)
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    access = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    await get_redis().setex(auth_refresh_key(user.id), _refresh_cookie_max_age(), refresh)
    await cache_auth_session(user.id, _serialize_user_for_cache(user))
    _set_refresh_cookie(response, refresh)
    return {
        "access_token": access,
        "token_type": "bearer",
        "user": _user_response(user).model_dump(by_alias=True),
    }


@router.post("/refresh")
async def refresh(
    request: Request,
    response: Response,
    refresh_token: str | None = Cookie(None, alias=COOKIE_KEY),
) -> dict:
    await _assert_rate_limit(request, "refresh")
    if refresh_token is None:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    result = verify_token(refresh_token, expected_type="refresh")
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    user_id, jti = result

    # Check refresh token blacklist
    if jti and await is_blacklisted(jti):
        raise HTTPException(status_code=401, detail="Refresh token has been revoked")

    # Check against Redis directly to ensure this is the active refresh token for the user
    expected_token = await get_redis().get(auth_refresh_key(user_id))
    if not expected_token or expected_token.decode() != refresh_token:
        raise HTTPException(status_code=401, detail="Refresh token invalid or superseded")

    user = await get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")

    # Refresh token rotation: consume current refresh token before issuing a new one.
    if jti:
        await blacklist_token(jti)

    new_access = create_access_token(user_id)
    new_refresh = create_refresh_token(user_id)
    await get_redis().setex(auth_refresh_key(user_id), _refresh_cookie_max_age(), new_refresh)
    _set_refresh_cookie(response, new_refresh)
    return {"access_token": new_access, "token_type": "bearer"}


@router.post("/logout")
async def logout(
    request: Request,
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
        verified_access = verify_token(creds.credentials, expected_type="access")
        access_jti: str | None = None

        if verified_access is not None:
            user_id, access_jti = verified_access
            await invalidate_auth_session(user_id)
            await get_redis().delete(auth_refresh_key(user_id))
        else:
            # Best effort fallback for partially invalid tokens (e.g. expired).
            access_jti = extract_jti(creds.credentials)
            user_id = extract_user_id(creds.credentials)
            if user_id:
                await get_redis().delete(auth_refresh_key(user_id))

        if access_jti:
            settings = get_settings()
            await blacklist_token(
                access_jti,
                ttl_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            )

    # Blacklist refresh token
    if refresh_token is not None:
        verified_refresh = verify_token(refresh_token, expected_type="refresh")
        refresh_jti = (
            verified_refresh[1] if verified_refresh is not None else extract_jti(refresh_token)
        )
        refresh_user_id = (
            verified_refresh[0] if verified_refresh is not None else extract_user_id(refresh_token)
        )
        if refresh_jti:
            await blacklist_token(refresh_jti)  # uses default REDIS_JWT_BLACKLIST_TTL
        if refresh_user_id:
            await get_redis().delete(auth_refresh_key(refresh_user_id))

    secure, same_site = _refresh_cookie_policy()
    response.delete_cookie(
        key=COOKIE_KEY,
        httponly=True,
        secure=secure,
        samesite=same_site,
        path=COOKIE_PATH,
    )
    return {"detail": "Logged out"}
