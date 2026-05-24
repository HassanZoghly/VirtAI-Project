import traceback
from datetime import datetime
from typing import Any

from fastapi import Request, WebSocket, status
from fastapi.responses import JSONResponse
from loguru import logger

from app.shared.config import get_settings


class AvatarBaseException(Exception):
    """Base exception for all avatar app errors"""

    def __init__(
        self,
        message: str,
        code: str = "UNKNOWN_ERROR",
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: dict[str, Any] | None = None,
    ):
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)


class ASRException(AvatarBaseException):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message=f"ASR Error: {message}", code="ASR_ERROR", details=details)


class LLMException(AvatarBaseException):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message=f"LLM Error: {message}", code="LLM_ERROR", details=details)


class TTSException(AvatarBaseException):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message=f"TTS Error: {message}", code="TTS_ERROR", details=details)


class AudioException(AvatarBaseException):
    def __init__(self, message: str, details: dict | None = None):
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
    def __init__(self, message: str, details: dict | None = None):
        super().__init__(
            message=f"Validation Error: {message}",
            code="VALIDATION_ERROR",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=details,
        )


class RAGException(AvatarBaseException):
    """Raised when RAG ingestion or retrieval fails."""

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(
            message=f"RAG Error: {message}",
            code="RAG_ERROR",
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            details=details,
        )


class EmptyDocumentError(RAGException):
    def __init__(self, message: str = "Document is empty", details: dict | None = None):
        super().__init__(message=message, details=details)


class UnsupportedFileType(RAGException):
    def __init__(self, message: str = "Unsupported file type", details: dict | None = None):
        self.status_code = status.HTTP_400_BAD_REQUEST
        super().__init__(message=message, details=details)


class IngestionCancelledException(RAGException):
    def __init__(self, message: str = "Ingestion cancelled", details: dict | None = None):
        super().__init__(message=message, details=details)


class DuplicateDocumentError(RAGException):
    def __init__(self, existing_doc_id: str):
        self.existing_doc_id = existing_doc_id
        self.status_code = status.HTTP_409_CONFLICT
        super().__init__(
            message="Duplicate document detected", details={"existing_doc_id": existing_doc_id}
        )


class ChunkLimitExceeded(RAGException):
    def __init__(
        self, message: str = "Document exceeds maximum chunk limit", details: dict | None = None
    ):
        self.status_code = status.HTTP_400_BAD_REQUEST
        super().__init__(message=message, details=details)


class VectorDimensionMismatch(RAGException):
    def __init__(self, expected: int, actual: int):
        self.expected = expected
        self.actual = actual
        super().__init__(
            message=f"Vector dimension mismatch. Expected {expected}, got {actual}",
            details={"expected": expected, "actual": actual},
        )


class IngestionQueueFull(RAGException):
    def __init__(self, message: str = "Ingestion queue is full", details: dict | None = None):
        self.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        super().__init__(message=message, details=details)


class ActiveJobLimitExceeded(RAGException):
    def __init__(
        self, message: str = "Too many active ingestion jobs", details: dict | None = None
    ):
        self.status_code = status.HTTP_429_TOO_MANY_REQUESTS
        super().__init__(message=message, details=details)


class ServiceUnavailableException(AvatarBaseException):
    def __init__(self, service: str):
        super().__init__(
            message=f"{service} service is currently unavailable",
            code="SERVICE_UNAVAILABLE",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            details={"service": service},
        )


class AuthenticationException(AvatarBaseException):
    """Raised when authentication fails (invalid credentials, expired token)."""

    def __init__(
        self,
        message: str = "Authentication failed",
        details: dict | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code="AUTHENTICATION_ERROR",
            status_code=status.HTTP_401_UNAUTHORIZED,
            details=details,
        )


class InvalidTokenError(AuthenticationException):
    """JWT is malformed, has the wrong type, or is missing required claims."""

    def __init__(self, message: str = "Invalid token", details: dict | None = None) -> None:
        super().__init__(message=message, details=details)
        self.code = "INVALID_TOKEN"


class ExpiredTokenError(AuthenticationException):
    """JWT signature is valid but the token is expired."""

    def __init__(self, message: str = "Token has expired", details: dict | None = None) -> None:
        super().__init__(message=message, details=details)
        self.code = "EXPIRED_TOKEN"


class InvalidUserIdError(AuthenticationException):
    """Token or request carried a non-UUID user identifier."""

    def __init__(
        self, message: str = "Invalid user identifier", details: dict | None = None
    ) -> None:
        super().__init__(message=message, details=details)
        self.code = "INVALID_USER_ID"


class RevokedTokenError(AuthenticationException):
    """JWT was explicitly revoked or superseded by refresh rotation."""

    def __init__(
        self, message: str = "Token has been revoked", details: dict | None = None
    ) -> None:
        super().__init__(message=message, details=details)
        self.code = "REVOKED_TOKEN"


class InvalidAuthStateError(AuthenticationException):
    """Authentication state is internally inconsistent or superseded."""

    def __init__(
        self,
        message: str = "Invalid authentication state",
        details: dict | None = None,
    ) -> None:
        super().__init__(message=message, details=details)
        self.code = "INVALID_AUTH_STATE"


class AuthorizationException(AvatarBaseException):
    """Raised when the user lacks permission for the requested action."""

    def __init__(
        self,
        message: str = "Insufficient permissions",
        details: dict | None = None,
    ) -> None:
        super().__init__(
            message=message,
            code="AUTHORIZATION_ERROR",
            status_code=status.HTTP_403_FORBIDDEN,
            details=details,
        )


class WebSocketException(Exception):
    """Custom WebSocket exception"""

    def __init__(self, message: str, code: str = "WS_ERROR"):
        self.message = message
        self.code = code
        super().__init__(message)


async def avatar_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, AvatarBaseException):
        raise exc

    if exc.status_code >= 500:
        logger.error(f"[{exc.code}] {exc.message} | Details: {exc.details}")
    else:
        logger.warning(f"[{exc.code}] {exc.message} | Path: {request.url.path}")

    response_content: dict[str, Any] = {
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


async def generic_exception_handler(request: Request[Any], exc: Exception) -> JSONResponse:
    settings = get_settings()
    if settings.DEBUG:
        logger.exception(f"Unhandled exception: {exc}")
    else:
        logger.error(f"Unhandled exception: {exc!s}")

    response_content: dict[str, Any] = {
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
