"""
Dependencies for API v1 endpoints.

Canonical location: app.presentation.http.v1.dependencies

Provides FastAPI dependency injection for:
- SessionManager (app-scoped, initialized in lifespan)
- WSConnectionManager (app-scoped, initialized in lifespan)
- Redis client
- Settings
"""

from typing import Annotated, Any, cast

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
    from app.application.rag.token_budget import TokenBudgetManager
    from app.infrastructure.vector.pgvector_store import SessionManagedPGVectorStore

    llm = request.app.state.model_policy.router.get_llm_chain()

    retrieval = RetrievalUseCase(
        embedder=request.app.state.embedder,
        vector_store=SessionManagedPGVectorStore(),
        reranker=request.app.state.reranker,
        budget_manager=TokenBudgetManager(),
    )
    return ChatUseCase(llm_provider=llm, retrieval_use_case=retrieval)


ChatUseCaseDep = Annotated[ChatUseCase, Depends(get_chat_use_case)]


# ── RAG Dependencies ─────────────────────────────────────────────────────────

from sqlalchemy.ext.asyncio import AsyncSession

from app.application.rag.nlp_operations import NLPOperations
from app.domain.rag.ports import EmbeddingProvider, LLMGenerationProvider, VectorCollectionStore
from app.domain.user.ports import UserRepositoryPort
from app.infrastructure.db.database import AsyncSessionLocal, get_db
from app.infrastructure.db.repositories.conversation_repository import ConversationRepository
from app.infrastructure.db.repositories.user_repository import UserRepository
from app.infrastructure.llm.provider_factory import LLMProviderFactory
from app.infrastructure.memory.memory_manager import MemoryManager
from app.infrastructure.rag.template_parser import TemplateParser
from app.infrastructure.vector.provider_factory import VectorDBProviderFactory


def get_llm_generation_provider(
    settings: Settings = Depends(get_settings),
) -> LLMGenerationProvider:
    factory = LLMProviderFactory(settings=settings)
    return factory.create(
        provider=settings.GENERATION_PROVIDER if hasattr(settings, "GENERATION_PROVIDER") else "OPENAI"
    )


def get_user_repository(db: AsyncSession = Depends(get_db)) -> UserRepositoryPort:
    return UserRepository(db)


UserRepositoryDep = Annotated[UserRepositoryPort, Depends(get_user_repository)]


def get_vector_collection_store(
    settings: Settings = Depends(get_settings),
) -> VectorCollectionStore:
    # Use AsyncSessionLocal as the session factory since PGVectorCollectionProvider uses `async with self.db_client():`
    factory = VectorDBProviderFactory(settings=settings, db_client=AsyncSessionLocal)
    return factory.create()


def get_memory_manager(db: AsyncSession = Depends(get_db)) -> MemoryManager:
    repo = ConversationRepository(db=db)
    return MemoryManager(conversation_repo=repo)


def get_nlp_operations(
    request: Request,
    vector_store: VectorCollectionStore = Depends(get_vector_collection_store),
    llm_provider: LLMGenerationProvider = Depends(get_llm_generation_provider),
    memory_manager: MemoryManager = Depends(get_memory_manager),
) -> NLPOperations:
    # Get embedding provider from app state just like get_chat_use_case
    embedding_provider: EmbeddingProvider = request.app.state.embedder
    template_parser = TemplateParser()

    return NLPOperations(
        vector_store=vector_store,
        llm_provider=llm_provider,
        embedding_provider=embedding_provider,
        template_parser=cast("Any", template_parser),
        memory_manager=memory_manager,
    )


NLPOperationsDep = Annotated[NLPOperations, Depends(get_nlp_operations)]
