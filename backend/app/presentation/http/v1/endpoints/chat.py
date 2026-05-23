"""Chat session management endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.user.entities import UserEntity
from app.infrastructure.db.database import get_db
from app.infrastructure.db.repositories.chat_repository import ChatRepository
from app.presentation.http.v1.endpoints.auth import _current_user
from app.shared.ids import parse_uuid

router = APIRouter()


@router.get("/", response_model=list[dict])
async def get_sessions(
    user: UserEntity = Depends(_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
) -> list[dict]:
    """List chat sessions for the current user."""
    try:
        repo = ChatRepository(db)
        sessions = await repo.list_user_sessions(str(user.id), limit=limit)
        return sessions
    except Exception as e:
        logger.error(f"Failed to list sessions for user {user.id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/", response_model=dict, status_code=201)
async def create_session(
    user: UserEntity = Depends(_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create a new chat session for the current user."""
    try:
        repo = ChatRepository(db)
        session = await repo.create_chat_session(str(user.id))
        return session
    except Exception as e:
        logger.error(f"Failed to create session for user {user.id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{session_id}/messages", response_model=list[dict])
async def get_messages(
    session_id: str,
    user: UserEntity = Depends(_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
) -> list[dict]:
    """Fetch message history for a specific session."""
    if parse_uuid(session_id) is None:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    try:
        repo = ChatRepository(db)
        session = await repo.get_chat_session(session_id)
        if not session or session.get("user_id") != str(user.id):
            raise HTTPException(status_code=404, detail="Session not found")
        messages = await repo.get_session_messages(session_id, limit=limit)
        return messages
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    except Exception as e:
        logger.error(f"Failed to fetch messages for session {session_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/all", status_code=204)
async def delete_all_sessions(
    user: UserEntity = Depends(_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Physically delete all sessions and messages for the user."""
    try:
        repo = ChatRepository(db)
        await repo.delete_all_user_sessions(str(user.id))
        await db.commit()
    except Exception as e:
        logger.error(f"Failed to delete all sessions for {user.id}: {e}")
        await db.rollback()
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    user: UserEntity = Depends(_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Physically delete a session and its messages."""
    if parse_uuid(session_id) is None:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    try:
        repo = ChatRepository(db)
        session = await repo.get_chat_session(session_id)
        if not session or session.get("user_id") != str(user.id):
            raise HTTPException(status_code=404, detail="Session not found")
        await repo.delete_chat_session(session_id)
    except HTTPException:
        raise
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")
    except Exception as e:
        logger.error(f"Failed to delete session {session_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


from pydantic import BaseModel

from app.presentation.http.v1.dependencies import ChatUseCaseDep


class RAGQuery(BaseModel):
    query: str


@router.post("/query", response_model=dict)
async def query_rag(
    chat_use_case: ChatUseCaseDep,
    payload: RAGQuery,
    user: UserEntity = Depends(_current_user),
) -> dict:
    """REST endpoint to perform a one-off RAG query."""
    try:
        response = await chat_use_case.execute_rag_query(payload.query, str(user.id))
        return {"response": response}
    except Exception as e:
        logger.error(f"RAG query failed: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
