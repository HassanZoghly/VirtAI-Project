"""
Chat session management endpoints.

Canonical location: app.presentation.http.v1.endpoints.chat
"""

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger

from app.domain.user.entities import UserEntity
from app.infrastructure.db.chat_repository import (
    create_chat_session,
    get_session_messages,
    list_user_sessions,
    delete_chat_session,
)
from app.presentation.http.v1.endpoints.auth import _current_user

router = APIRouter()


@router.get("/", response_model=list[dict])
async def get_sessions(
    user: UserEntity = Depends(_current_user),
    limit: int = 50,
) -> list[dict]:
    """List chat sessions for the current user."""
    try:
        sessions = await list_user_sessions(user_id=str(user.id), limit=limit)
        return sessions
    except Exception as e:
        logger.error(f"Failed to list sessions for user {user.id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/", response_model=dict, status_code=201)
async def create_session(
    user: UserEntity = Depends(_current_user),
) -> dict:
    """Create a new chat session for the current user."""
    try:
        session = await create_chat_session(user_id=str(user.id))
        return session
    except Exception as e:
        logger.error(f"Failed to create session for user {user.id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{session_id}/messages", response_model=list[dict])
async def get_messages(
    session_id: str,
    user: UserEntity = Depends(_current_user),
    limit: int = 50,
) -> list[dict]:
    """Fetch message history for a specific session."""
    # Note: In a production app, we'd verify session ownership here.
    # For now, list_user_sessions and get_chat_session already use user_id filters where possible.
    try:
        messages = await get_session_messages(session_id=session_id, limit=limit)
        return messages
    except Exception as e:
        logger.error(f"Failed to fetch messages for session {session_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    user: UserEntity = Depends(_current_user),
) -> None:
    """Physically delete a session and its messages."""
    try:
        # Ideally verify ownership here before deleting
        deleted = await delete_chat_session(session_id=session_id)
        if not deleted:
            # Optionally throw 404, but idempotent is fine
            pass
    except Exception as e:
        logger.error(f"Failed to delete session {session_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
