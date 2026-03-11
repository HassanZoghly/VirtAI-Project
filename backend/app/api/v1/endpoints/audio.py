"""Backward-compat shim -- canonical source is app.presentation.http.v1.endpoints.audio."""
from app.presentation.http.v1.endpoints.audio import (  # noqa: F401
    AUDIO_STORAGE_PATH,
    is_safe_path_component,
    get_audio_file,
    router,
)
