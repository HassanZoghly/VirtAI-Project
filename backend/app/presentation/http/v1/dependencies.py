"""
Dependencies for API v1 endpoints.

Canonical location: app.presentation.http.v1.dependencies

Provides FastAPI dependency injection for:
- SessionManager (app-scoped, initialized in lifespan)
- WSConnectionManager (app-scoped, initialized in lifespan)
- Redis client
- Settings
"""

from typing import Annotated

import redis.asyncio as aioredis
from fastapi import Depends, Request

from app.application.chat.session_manager import SessionManager

# RAG specific imports
from app.domain.storage.ports import StorageProvider
from app.infrastructure.cache.redis_client import get_redis
from app.presentation.ws.connection_manager import WSConnectionManager
from app.shared.config import Settings, get_settings

# Application-scoped SessionManager instance
# Initialised in main.py lifespan and stored here
_session_manager: SessionManager | None = None
_connection_manager: WSConnectionManager | None = None


def init_session_manager(manager: SessionManager) -> None:
    """
    Initialise the session manager (called from main.py lifespan).

    Args:
        manager: SessionManager instance to use for the application
    """
    global _session_manager
    _session_manager = manager


def init_ws_connection_manager(manager: WSConnectionManager) -> None:
    """Initialise WebSocket connection manager (called from main.py lifespan)."""
    global _connection_manager
    _connection_manager = manager


def get_session_manager() -> SessionManager:
    """
    Dependency injection function for SessionManager.

    Returns:
        SessionManager: The application-scoped session manager instance

    Raises:
        RuntimeError: If session manager has not been initialised
    """
    if _session_manager is None:
        raise RuntimeError(
            "SessionManager not initialised. Ensure init_session_manager() is called in lifespan."
        )
    return _session_manager


def get_ws_connection_manager() -> WSConnectionManager:
    """Dependency injection function for WebSocket connection manager."""
    if _connection_manager is None:
        raise RuntimeError(
            "WSConnectionManager not initialised. "
            "Ensure init_ws_connection_manager() is called in lifespan."
        )
    return _connection_manager


def get_redis_client() -> aioredis.Redis:
    """Dependency: return the active Redis client."""
    return get_redis()


# Type aliases for dependency injection
SessionManagerDep = Annotated[SessionManager, Depends(get_session_manager)]
WSConnectionManagerDep = Annotated[WSConnectionManager, Depends(get_ws_connection_manager)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
RedisDep = Annotated[aioredis.Redis, Depends(get_redis_client)]


def get_storage(request: Request) -> StorageProvider:
    return request.app.state.storage


StorageDep = Annotated[StorageProvider, Depends(get_storage)]

from app.application.chat.chat_use_case import ChatUseCase


async def get_chat_use_case(request: Request) -> ChatUseCase:
    """Dependency injection for ChatUseCase."""
    from app.application.rag.retrieval_use_case import RetrievalUseCase
    from app.infrastructure.llm.groq_provider import GroqLLMProvider
    from app.shared.config import get_settings

    settings = get_settings()
    llm = GroqLLMProvider(
        model=settings.LLM_MODEL,
        max_tokens=settings.LLM_MAX_TOKENS,
        temperature=settings.LLM_TEMPERATURE,
        api_key=settings.GROQ_API_KEY or "dummy-key-for-dev",
    )
    retrieval = RetrievalUseCase(embedder=request.app.state.embedder)
    return ChatUseCase(llm_provider=llm, retrieval_use_case=retrieval)


ChatUseCaseDep = Annotated[ChatUseCase, Depends(get_chat_use_case)]
