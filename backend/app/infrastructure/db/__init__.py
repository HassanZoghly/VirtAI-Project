"""
Infrastructure DB package.

Public re-exports for database access components.
The old SQLAlchemy database/models/repositories modules have been
replaced by MongoDB equivalents.
"""

from app.infrastructure.db.mongodb import (
    avatars_col,
    chat_sessions_col,
    close_mongodb,
    documents_col,
    get_database,
    init_mongodb,
    messages_col,
    users_col,
)
from app.infrastructure.db.user_repository import MongoUserRepository
