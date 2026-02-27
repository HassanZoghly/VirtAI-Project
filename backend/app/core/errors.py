import traceback
from datetime import datetime
from typing import Any, Optional

from fastapi import Request, WebSocket, status
from fastapi.responses import JSONResponse
from loguru import logger

from app.core.config import get_settings


class AvatarBaseException(Exception):
    """Base exception for all avatar app errors"""

    def __init__(
        self,
        message: str,
        code: str = "UNKNOWN_ERROR",
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: Optional[dict[str, Any]] = None,
    ):
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)


class ASRException(AvatarBaseException):
    def __init__(self, message: str, details: Optional[dict] = None):
        super().__init__(message=f"ASR Error: {message}", code="ASR_ERROR", details=details)


class LLMException(AvatarBaseException):
    def __init__(self, message: str, details: Optional[dict] = None):
        super().__init__(message=f"LLM Error: {message}", code="LLM_ERROR", details=details)


class TTSException(AvatarBaseException):
    def __init__(self, message: str, details: Optional[dict] = None):
        super().__init__(message=f"TTS Error: {message}", code="TTS_ERROR", details=details)


class AudioException(AvatarBaseException):
    def __init__(self, message: str, details: Optional[dict] = None):
        super().__init__(message=f"Audio Error: {message}", code="AUDIO_ERROR", details=details)


class RateLimitException(AvatarBaseException):
    def __init__(self, retry_after: int = 60):
        super().__init__(
            message="Too many requests. Please try again later.",
            code="RATE_LIMIT",
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            details={"retry_after": retry_after},
        )


class ValidationException(AvatarBaseException):
    def __init__(self, message: str, details: Optional[dict] = None):
        super().__init__(
            message=f"Validation Error: {message}",
            code="VALIDATION_ERROR",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=details,
        )


class ServiceUnavailableException(AvatarBaseException):
    def __init__(self, service: str):
        super().__init__(
            message=f"{service} service is currently unavailable",
            code="SERVICE_UNAVAILABLE",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            details={"service": service},
        )


class WebSocketException(Exception):
    """Custom WebSocket exception"""

    def __init__(self, message: str, code: str = "WS_ERROR"):
        self.message = message
        self.code = code
        super().__init__(message)


async def avatar_exception_handler(request: Request, exc: AvatarBaseException) -> JSONResponse:
    if exc.status_code >= 500:
        logger.error(f"[{exc.code}] {exc.message} | Details: {exc.details}")
    else:
        logger.warning(f"[{exc.code}] {exc.message} | Path: {request.url.path}")

    response_content = {
        "error": exc.code,
        "message": exc.message,
        "timestamp": datetime.utcnow().isoformat(),
        "path": request.url.path,
    }

    settings = get_settings()
    if settings.DEBUG and exc.details:
        response_content["details"] = exc.details

    return JSONResponse(
        status_code=exc.status_code,
        content=response_content,
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(f"Unhandled exception: {exc}")

    response_content = {
        "error": "INTERNAL_ERROR",
        "message": "An unexpected error occurred",
        "timestamp": datetime.utcnow().isoformat(),
        "path": request.url.path,
    }

    settings = get_settings()
    if settings.DEBUG:
        response_content["traceback"] = traceback.format_exc()

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=response_content,
    )


async def websocket_exception_handler(websocket: WebSocket, exc: WebSocketException):
    logger.error(f"WebSocket error [{exc.code}]: {exc.message}")
    await websocket.close(code=1008, reason=exc.message)
