"""JWT token creation / verification and password hashing utilities."""

import uuid
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.shared.config import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------


def _create_token(
    data: dict,
    expires_delta: timedelta,
    token_type: str,
) -> str:
    settings = get_settings()
    payload = data.copy()
    jti = str(uuid.uuid4())  # unique token ID — used for blacklisting
    payload.update(
        {
            "exp": datetime.now(timezone.utc) + expires_delta,
            "type": token_type,
            "jti": jti,
        }
    )
    return jwt.encode(
        payload,
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def create_access_token(user_id: str) -> str:
    settings = get_settings()
    return _create_token(
        data={"sub": user_id},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        token_type="access",
    )


def create_refresh_token(user_id: str, token_version: int = 0) -> str:
    settings = get_settings()
    return _create_token(
        data={"sub": user_id, "token_version": token_version},
        expires_delta=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        token_type="refresh",
    )


def verify_token(
    token: str, expected_type: str = "access"
) -> tuple[str, str] | tuple[str, str, int] | None:
    """
    Decode and verify a JWT token.

    Returns:
        (user_id, jti) tuple on success for access tokens.
        (user_id, jti, token_version) tuple on success for refresh tokens.
        None on failure (invalid, expired, wrong type).
    """
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=["HS256"],
        )
        if payload.get("type") != expected_type:
            return None
        user_id = payload.get("sub")
        jti = payload.get("jti", "")
        if not user_id:
            return None
        if expected_type == "refresh":
            return user_id, jti, int(payload.get("token_version", 0))
        return user_id, jti
    except JWTError:
        return None


def extract_jti(token: str) -> str | None:
    """Extract JTI from a token without full verification (for blacklisting on logout)."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=["HS256"],
            options={"verify_exp": False},  # allow expired tokens to be blacklisted
        )
        return payload.get("jti")
    except JWTError:
        return None


def extract_user_id(token: str) -> str | None:
    """Extract user_id (sub) from a token without full verification."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=["HS256"],
            options={"verify_exp": False},
        )
        return payload.get("sub")
    except JWTError:
        return None
