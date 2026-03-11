"""Backward-compat shim - import from app.shared.errors instead."""
from app.shared.errors import (  # noqa: F401
    ASRException,
    AudioException,
    AuthenticationException,
    AuthorizationException,
    AvatarBaseException,
    LLMException,
    RateLimitException,
    ServiceUnavailableException,
    TTSException,
    ValidationException,
    WebSocketException,
    avatar_exception_handler,
    generic_exception_handler,
    websocket_exception_handler,
)
