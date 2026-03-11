"""Backward-compat shim - canonical source is app.domain.chat.policies."""
from app.domain.chat.policies import (  # noqa: F401
    AVATAR_PROMPTS,
    DEFAULT_PROMPT,
    EMOTION_INSTRUCTIONS,
    build_conversation,
    get_system_prompt,
)
