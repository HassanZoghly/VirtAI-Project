"""Backward-compat shim -- canonical source is app.infrastructure.auth.auth_service."""
from app.infrastructure.auth.auth_service import (  # noqa: F401
    authenticate_user,
    build_google_auth_url,
    exchange_google_code,
    get_or_create_google_user,
    get_user_by_email,
    get_user_by_id,
    register_user,
)
