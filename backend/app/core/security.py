"""JWT token creation / verification and password hashing utilities."""

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

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
    payload.update(
        {
            "exp": datetime.now(timezone.utc) + expires_delta,
            "type": token_type,
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


def create_refresh_token(user_id: str) -> str:
    settings = get_settings()
    return _create_token(
        data={"sub": user_id},
        expires_delta=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        token_type="refresh",
    )


def verify_token(token: str, expected_type: str = "access") -> str | None:
    """Return the *user_id* embedded in the token, or ``None`` on failure."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        if payload.get("type") != expected_type:
            return None
        return payload.get("sub")
    except JWTError:
        return None
