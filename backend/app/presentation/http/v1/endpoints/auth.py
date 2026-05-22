"""Authentication API endpoints — login, signup, Google OAuth, token refresh, logout."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.application.auth.auth_use_cases import (
    authenticate_user,
    build_google_auth_url,
    exchange_google_code,
    get_or_create_google_user,
    get_user_by_email,
    get_user_by_id,
    register_user,
    revoke_user_token_version,
    rotate_refresh_token_version,
    set_user_setup_complete,
)
from app.domain.user.entities import AuthProvider, UserEntity
from app.infrastructure.cache.auth_session_cache import (
    cache_auth_session,
    get_cached_auth_session,
    invalidate_auth_session,
)
from app.infrastructure.cache.cache_keys import auth_refresh_key
from app.infrastructure.cache.jwt_blacklist import blacklist_token, is_blacklisted
from app.infrastructure.cache.rate_limiter import check_rate_limit
from app.infrastructure.cache.redis_client import get_redis
from app.infrastructure.cache.refresh_token_family import (
    acquire_refresh_rotation_lock,
    is_refresh_family_revoked,
    is_refresh_jti_consumed,
    mark_refresh_rotated,
    release_refresh_rotation_lock,
    revoke_all_refresh_families,
    revoke_refresh_family,
    store_initial_refresh_token,
)
from app.infrastructure.db.database import get_db
from app.schemas.auth import (
    GoogleCallbackRequest,
    LoginRequest,
    SetupStatusRequest,
    SignupRequest,
    UserResponse,
)
from app.shared.config import Environment, get_settings
from app.shared.errors import (
    ExpiredTokenError,
    InvalidAuthStateError,
    InvalidTokenError,
    InvalidUserIdError,
    RevokedTokenError,
)
from app.shared.ids import parse_uuid
from app.shared.security import (
    create_access_token,
    create_refresh_token,
    decode_auth_token,
    extract_jti,
    extract_user_id,
    verify_token,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

_bearer = HTTPBearer(auto_error=False)
router = APIRouter()

COOKIE_KEY = "refresh_token"
COOKIE_PATH = "/api/v1/auth"


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
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "username": user.username,
        "provider": user.provider.value,
        "google_id": user.google_id,
        "setup_complete": user.setup_complete,
        "is_active": user.is_active,
        "refresh_token_version": user.refresh_token_version,
        "created_at": user.created_at.isoformat(),
        "updated_at": user.updated_at.isoformat(),
    }


def _parse_dt(raw: str | None) -> datetime:
    if not raw:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return datetime.now(timezone.utc)


def _coerce_provider(value: str | AuthProvider | None) -> AuthProvider:
    if isinstance(value, AuthProvider):
        return value
    if not value:
        return AuthProvider.LOCAL
    try:
        return AuthProvider(value)
    except ValueError:
        return AuthProvider.LOCAL


def _deserialize_cached_user(data: dict) -> UserEntity:
    user_id = parse_uuid(data.get("id"))
    if user_id is None:
        raise InvalidAuthStateError("Cached auth session has invalid user id")
    return UserEntity(
        id=user_id,
        email=data["email"],
        full_name=data.get("full_name", ""),
        username=data.get("username"),
        password_hash=None,
        provider=_coerce_provider(data.get("provider")),
        google_id=data.get("google_id"),
        setup_complete=data.get("setup_complete", False),
        is_active=data.get("is_active", True),
        refresh_token_version=int(data.get("refresh_token_version", 0)),
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
    db: AsyncSession = Depends(get_db),
) -> UserEntity:
    """Dependency: resolve Bearer token → UserEntity, checking blacklist."""
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token_payload = decode_auth_token(creds.credentials, expected_type="access")
    user_id = token_payload.user_id
    jti = token_payload.jti

    if jti and await is_blacklisted(jti):
        raise RevokedTokenError()

    cached = await get_cached_auth_session(str(user_id))
    if cached is not None:
        user = _deserialize_cached_user(cached)
        if not user.is_active:
            raise HTTPException(status_code=403, detail="User account is inactive")
        if token_payload.token_version != user.refresh_token_version:
            raise RevokedTokenError("Access token is stale")
        return user

    user = await get_user_by_id(db, user_id)
    if user is None:
        raise InvalidTokenError("User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    if token_payload.token_version != user.refresh_token_version:
        raise RevokedTokenError("Access token is stale")
    await cache_auth_session(str(user_id), _serialize_user_for_cache(user))
    return user


def _refresh_cookie_max_age() -> int:
    settings = get_settings()
    return settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60


def _refresh_cookie_policy() -> tuple[bool, str]:
    settings = get_settings()
    return Environment.production == settings.ENVIRONMENT, "lax"


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


def _delete_refresh_cookie(response: Response) -> None:
    secure, same_site = _refresh_cookie_policy()
    response.delete_cookie(
        key=COOKIE_KEY,
        httponly=True,
        secure=secure,
        samesite=same_site,
        path=COOKIE_PATH,
    )


def _first_name_from_full_name(full_name: str) -> str:
    stripped = full_name.strip()
    if not stripped:
        return ""
    parts = stripped.split()
    return parts[0] if parts else ""


def _user_response(user: UserEntity) -> UserResponse:
    return UserResponse(
        id=str(user.id),
        first_name=_first_name_from_full_name(user.full_name),
        email=user.email,
        is_new_user=not user.setup_complete,
        setup_complete=user.setup_complete,
    )


def _issue_tokens(user: UserEntity, family_id: str | None = None) -> tuple[str, str, str]:
    access = create_access_token(user.id, user.refresh_token_version)
    refresh = create_refresh_token(user.id, user.refresh_token_version, family_id=family_id)
    refresh_payload = decode_auth_token(refresh, expected_type="refresh")
    if refresh_payload.family_id is None:
        raise InvalidAuthStateError("Refresh token missing family")
    return access, refresh, str(refresh_payload.family_id)


async def _store_initial_refresh(user: UserEntity, refresh: str, family_id: str) -> None:
    refresh_payload = decode_auth_token(refresh, expected_type="refresh")
    await store_initial_refresh_token(
        str(user.id),
        family_id,
        refresh,
        refresh_payload.jti,
        _refresh_cookie_max_age(),
    )


@router.post("/login")
async def login(
    body: LoginRequest,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _assert_rate_limit(request, "login")
    user = await authenticate_user(db, body.email, body.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    access, refresh, family_id = _issue_tokens(user)
    await _store_initial_refresh(user, refresh, family_id)
    await cache_auth_session(str(user.id), _serialize_user_for_cache(user))
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
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _assert_rate_limit(request, "signup")
    existing = await get_user_by_email(db, body.email)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already registered")
    user = await register_user(db, body.full_name, body.email, body.password)
    access, refresh, family_id = _issue_tokens(user)
    await _store_initial_refresh(user, refresh, family_id)
    await cache_auth_session(str(user.id), _serialize_user_for_cache(user))
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
    db: AsyncSession = Depends(get_db),
) -> dict:
    updated = await set_user_setup_complete(db, user.id, body.setup_complete)
    if updated is None:
        raise HTTPException(status_code=404, detail="User not found")
    await invalidate_auth_session(str(user.id))
    await cache_auth_session(str(updated.id), _serialize_user_for_cache(updated))
    return _user_response(updated).model_dump(by_alias=True)


@router.get("/csrf")
async def get_csrf_token(request: Request, response: Response) -> dict:
    return {"detail": "CSRF cookie set"}


@router.get("/google/url")
async def google_url() -> dict:
    state = secrets.token_urlsafe(32)
    await get_redis().setex(f"oauth:state:{state}", 300, "1")
    return {"url": build_google_auth_url(state)}


@router.post("/google/callback")
async def google_callback(
    body: GoogleCallbackRequest,
    response: Response,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _assert_rate_limit(request, "google_callback")
    redis = get_redis()
    state_key = f"oauth:state:{body.state}"
    is_valid_state = await redis.get(state_key)
    if not is_valid_state:
        raise HTTPException(status_code=400, detail="Invalid or expired state parameter")
    await redis.delete(state_key)
    google_info = await exchange_google_code(body.code)
    user = await get_or_create_google_user(db, google_info)
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    access, refresh, family_id = _issue_tokens(user)
    await _store_initial_refresh(user, refresh, family_id)
    await cache_auth_session(str(user.id), _serialize_user_for_cache(user))
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
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _assert_rate_limit(request, "refresh")
    if refresh_token is None:
        raise HTTPException(status_code=401, detail="Missing refresh token")
    try:
        token_payload = decode_auth_token(refresh_token, expected_type="refresh")
        user_id = token_payload.user_id
        jti = token_payload.jti
        token_version = token_payload.token_version
        family_id = str(token_payload.family_id) if token_payload.family_id else None
        if family_id is None:
            raise InvalidAuthStateError("Refresh token missing family")
        if jti and await is_blacklisted(jti):
            raise RevokedTokenError("Refresh token has been revoked")
        if await is_refresh_family_revoked(str(user_id), family_id):
            raise RevokedTokenError("Refresh token family has been revoked")
        if await is_refresh_jti_consumed(jti):
            await revoke_all_refresh_families(
                str(user_id), reason="refresh_reuse_detected", replay_jti=jti
            )
            await revoke_user_token_version(db, user_id)
            await invalidate_auth_session(str(user_id))
            await blacklist_token(jti)
            raise RevokedTokenError("Refresh token reuse detected")

        lock_token = await acquire_refresh_rotation_lock(str(user_id), family_id)
        if lock_token is None:
            raise HTTPException(status_code=409, detail="Refresh already in progress")

        redis = get_redis()
        try:
            stored_refresh = await redis.get(auth_refresh_key(str(user_id), family_id))
            if isinstance(stored_refresh, bytes):
                stored_refresh = stored_refresh.decode("utf-8")
            if stored_refresh is not None and stored_refresh != refresh_token:
                raise RevokedTokenError("Refresh token has been superseded")

            user = await get_user_by_id(db, user_id)
            if user is None:
                raise InvalidTokenError("User not found")
            if not user.is_active:
                raise HTTPException(status_code=403, detail="User account is inactive")
            if token_version != user.refresh_token_version:
                raise RevokedTokenError("Refresh token invalid or superseded")

            rotated_user = await rotate_refresh_token_version(db, user_id, token_version)
            if rotated_user is None:
                raise RevokedTokenError("Refresh token invalid or superseded")

            new_access, new_refresh, _ = _issue_tokens(rotated_user, family_id=family_id)
            new_refresh_payload = decode_auth_token(new_refresh, expected_type="refresh")
            await mark_refresh_rotated(
                str(user_id),
                family_id,
                jti,
                new_refresh_payload.jti,
                new_refresh,
                _refresh_cookie_max_age(),
            )
            await blacklist_token(jti)
            await invalidate_auth_session(str(user_id))
            _set_refresh_cookie(response, new_refresh)
            return {"access_token": new_access, "token_type": "bearer"}
        finally:
            await release_refresh_rotation_lock(str(user_id), family_id, lock_token)
    except (
        ExpiredTokenError,
        InvalidAuthStateError,
        InvalidTokenError,
        InvalidUserIdError,
        RevokedTokenError,
    ):
        _delete_refresh_cookie(response)
        raise


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    user: UserEntity = Depends(_current_user),
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    refresh_token: str | None = Cookie(None, alias=COOKIE_KEY),
) -> dict:
    # Blacklist access token
    if creds is not None:
        verified = verify_token(creds.credentials, expected_type="access")
        access_jti = None
        if verified is not None:
            user_id, access_jti = verified
            await invalidate_auth_session(user_id)
        else:
            access_jti = extract_jti(creds.credentials)
            user_id = extract_user_id(creds.credentials)
            if user_id:
                await invalidate_auth_session(user_id)
        if access_jti:
            settings = get_settings()
            await blacklist_token(access_jti, ttl_seconds=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    # Blacklist refresh token
    if refresh_token is not None:
        refresh_payload = None
        try:
            refresh_payload = decode_auth_token(refresh_token, expected_type="refresh")
        except (ExpiredTokenError, InvalidAuthStateError, InvalidTokenError, InvalidUserIdError):
            refresh_payload = None
        refresh_jti = refresh_payload.jti if refresh_payload else extract_jti(refresh_token)
        refresh_user_id = (
            str(refresh_payload.user_id) if refresh_payload else extract_user_id(refresh_token)
        )
        if refresh_jti:
            await blacklist_token(refresh_jti)
        if refresh_user_id and refresh_payload and refresh_payload.family_id:
            await revoke_refresh_family(
                refresh_user_id,
                str(refresh_payload.family_id),
                reason="logout",
                replay_jti=None,
            )
    _delete_refresh_cookie(response)
    return {"detail": "Logged out"}
