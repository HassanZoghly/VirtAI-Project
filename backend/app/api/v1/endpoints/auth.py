"""Backward-compat shim -- canonical source is app.presentation.http.v1.endpoints.auth."""
from app.presentation.http.v1.endpoints.auth import (  # noqa: F401
    COOKIE_KEY,
    COOKIE_PATH,
    COOKIE_MAX_AGE,
    login,
    signup,
    me,
    google_url,
    google_callback,
    refresh,
    logout,
    router,
)
