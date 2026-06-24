"""
Infrastructure DB package.

PostgreSQL + SQLAlchemy 2.0 async.
Exports database session, models, and repositories.
"""

from app.infrastructure.db.database import AsyncSessionLocal, Base, close_db, get_db, init_db
from app.infrastructure.db.models import (
    Avatar,
    ChatSession,
    Document,
    DocumentChunk,
    Message,
    User,
)
from app.infrastructure.db.repositories.avatar_repository import AvatarRepository
from app.infrastructure.db.repositories.chat_repository import ChatRepository
from app.infrastructure.db.repositories.document_crud_repository import DocumentCrudRepository
from app.infrastructure.db.repositories.ingestion_state_repository import IngestionStateRepository
from app.infrastructure.db.repositories.document_integrity_service import DocumentIntegrityService
from app.infrastructure.db.repositories.user_repository import UserRepository

__all__ = [
    # database
    "AsyncSessionLocal",
    "Base",
    "get_db",
    "init_db",
    "close_db",
    # models
    "User",
    "ChatSession",
    "Message",
    "Avatar",
    "Document",
    "DocumentChunk",
    # repositories
    "UserRepository",
    "ChatRepository",
    "AvatarRepository",
    "DocumentCrudRepository",
    "IngestionStateRepository",
    "DocumentIntegrityService",
]
