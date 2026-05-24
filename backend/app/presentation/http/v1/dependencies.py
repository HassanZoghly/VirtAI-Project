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

_chat_use_case: ChatUseCase | None = None

async def get_chat_use_case(request: Request) -> ChatUseCase:
    """Dependency injection for ChatUseCase."""
    global _chat_use_case
    if _chat_use_case is None:
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
        _chat_use_case = ChatUseCase(llm_provider=llm, retrieval_use_case=retrieval)

    return _chat_use_case


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

_llm_generation_provider: LLMGenerationProvider | None = None

def get_llm_generation_provider(
    settings: Settings = Depends(get_settings),
) -> LLMGenerationProvider:
    global _llm_generation_provider
    if _llm_generation_provider is None:
        factory = LLMProviderFactory(settings=settings)
        _llm_generation_provider = factory.create(
            provider=settings.GENERATION_PROVIDER if hasattr(settings, "GENERATION_PROVIDER") else "OPENAI"
        )
    return _llm_generation_provider


def get_user_repository(db: AsyncSession = Depends(get_db)) -> UserRepositoryPort:
    return UserRepository(db)


UserRepositoryDep = Annotated[UserRepositoryPort, Depends(get_user_repository)]


_vector_store: VectorCollectionStore | None = None

def get_vector_collection_store(
    settings: Settings = Depends(get_settings),
) -> VectorCollectionStore:
    global _vector_store
    if _vector_store is None:
        # Use AsyncSessionLocal as the session factory since PGVectorCollectionProvider uses `async with self.db_client():`
        factory = VectorDBProviderFactory(settings=settings, db_client=AsyncSessionLocal)
        _vector_store = factory.create()
    return _vector_store


def get_memory_manager(db: AsyncSession = Depends(get_db)) -> MemoryManager:
    repo = ConversationRepository(db=db)
    return MemoryManager(conversation_repo=repo)


_template_parser: TemplateParser | None = None

def get_nlp_operations(
    request: Request,
    vector_store: VectorCollectionStore = Depends(get_vector_collection_store),
    llm_provider: LLMGenerationProvider = Depends(get_llm_generation_provider),
    memory_manager: MemoryManager = Depends(get_memory_manager),
) -> NLPOperations:
    global _template_parser
    if _template_parser is None:
        _template_parser = TemplateParser()

    # Get embedding provider from app state just like get_chat_use_case
    embedding_provider: EmbeddingProvider = request.app.state.embedder

    return NLPOperations(
        vector_store=vector_store,
        llm_provider=llm_provider,
        embedding_provider=embedding_provider,
        template_parser=cast("Any", _template_parser),
        memory_manager=memory_manager,
    )


NLPOperationsDep = Annotated[NLPOperations, Depends(get_nlp_operations)]

from datetime import datetime, timezone

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.application.auth.auth_use_cases import get_user_by_id
from app.domain.user.entities import AuthProvider, UserEntity
from app.infrastructure.cache.auth_session_cache import cache_auth_session, get_cached_auth_session
from app.shared.errors import InvalidAuthStateError, InvalidTokenError, RevokedTokenError
from app.shared.ids import parse_uuid
from app.shared.security import decode_auth_token

_bearer = HTTPBearer(auto_error=False)

def _parse_dt(raw: str | None) -> datetime:
    if not raw:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(raw)
    except Exception:
        return datetime.now(timezone.utc)

def _coerce_provider(value: str | AuthProvider | None) -> AuthProvider:
    if isinstance(value, AuthProvider):
        return value
    if not value:
        return AuthProvider.LOCAL
    try:
        return AuthProvider(value)
    except ValueError:
        return AuthProvider.LOCAL

def _deserialize_cached_user(data: dict) -> UserEntity:
    user_id = parse_uuid(data.get("id"))
    if user_id is None:
        raise InvalidAuthStateError("Cached auth session has invalid user id")
    return UserEntity(
        id=user_id,
        email=data["email"],
        full_name=data.get("full_name", ""),
        username=data.get("username"),
        password_hash=None,
        provider=_coerce_provider(data.get("provider")),
        google_id=data.get("google_id"),
        setup_complete=data.get("setup_complete", False),
        is_active=data.get("is_active", True),
        refresh_token_version=int(data.get("refresh_token_version", 0)),
        created_at=_parse_dt(data.get("created_at")),
        updated_at=_parse_dt(data.get("updated_at")),
    )

def _serialize_user_for_cache(user: UserEntity) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "username": user.username,
        "provider": user.provider.value,
        "google_id": user.google_id,
        "setup_complete": user.setup_complete,
        "is_active": user.is_active,
        "refresh_token_version": user.refresh_token_version,
        "created_at": user.created_at.isoformat(),
        "updated_at": user.updated_at.isoformat(),
    }

async def _current_user(
    request: Request,
    repo: UserRepositoryDep,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UserEntity:
    """Dependency: resolve Bearer token → UserEntity, checking blacklist."""
    from app.infrastructure.cache.jwt_blacklist import is_blacklisted
    if creds is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token_payload = decode_auth_token(creds.credentials, expected_type="access")
    user_id = token_payload.user_id
    jti = token_payload.jti

    if jti and await is_blacklisted(jti):
        raise RevokedTokenError()

    cached = await get_cached_auth_session(str(user_id))
    if cached is not None:
        user = _deserialize_cached_user(cached)
        if not user.is_active:
            raise HTTPException(status_code=403, detail="User account is inactive")
        if token_payload.token_version != user.refresh_token_version:
            raise RevokedTokenError("Access token is stale")
        return user

    user = await get_user_by_id(repo, user_id)
    if user is None:
        raise InvalidTokenError("User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    if token_payload.token_version != user.refresh_token_version:
        raise RevokedTokenError("Access token is stale")
    await cache_auth_session(str(user_id), _serialize_user_for_cache(user))
    return user
