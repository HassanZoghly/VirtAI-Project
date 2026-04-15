"""
Infrastructure DB package.

Public re-exports for database access components.
The old SQLAlchemy database/models/repositories modules have been
replaced by MongoDB equivalents.
"""

from app.infrastructure.db.mongodb import (  # noqa: F401
    init_mongodb,
    close_mongodb,
    get_database,
    users_col,
    avatars_col,
    chat_sessions_col,
    messages_col,
    documents_col,
)
from app.infrastructure.db.user_repository import MongoUserRepository  # noqa: F401
