"""Backward-compat shim - import from app.shared.security instead."""
from app.shared.security import (  # noqa: F401
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
    verify_token,
)
