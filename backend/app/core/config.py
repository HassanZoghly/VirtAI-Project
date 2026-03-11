"""Backward-compat shim - import from app.shared.config instead."""
from app.shared.config import Settings, get_settings  # noqa: F401

__all__ = ["Settings", "get_settings"]
