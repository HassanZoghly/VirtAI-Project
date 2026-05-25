"""Audio file serving endpoint."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Path as PathParam
from fastapi.responses import FileResponse
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.user.entities import UserEntity
from app.infrastructure.db.database import get_db
from app.infrastructure.db.repositories.chat_repository import ChatRepository
from app.presentation.http.v1.dependencies import _current_user
from app.shared.audio_ids import is_safe_path_component, is_valid_audio_message_id
from app.shared.config import get_settings
from app.shared.ids import parse_uuid

router = APIRouter()

AUDIO_STORAGE_PATH = Path(get_settings().AUDIO_STORAGE_PATH)


@router.get(
    "/audio/{session_id}/{message_id}.mp3",
    response_class=FileResponse,
    responses={
        200: {"description": "Audio file", "content": {"audio/mpeg": {}}},
        404: {"description": "Audio file not found"},
        400: {"description": "Invalid session_id or message_id"},
    },
)
async def get_audio_file(
    session_id: Annotated[str, PathParam(description="Session identifier")],
    message_id: Annotated[str, PathParam(description="Message identifier")],
    user: UserEntity = Depends(_current_user),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    if not is_safe_path_component(session_id) or parse_uuid(session_id) is None:
        logger.warning(f"Invalid session_id attempted: {session_id}")
        raise HTTPException(status_code=400, detail=f"Invalid session_id format: {session_id}")

    if not is_valid_audio_message_id(message_id):
        logger.warning(f"Invalid message_id attempted: {message_id}")
        raise HTTPException(status_code=400, detail=f"Invalid message_id format: {message_id}")

    repo = ChatRepository(db)
    db_session = await repo.get_chat_session(session_id)
    if db_session is None or db_session.get("user_id") != str(user.id):
        logger.warning(f"Session not found or unauthorized for session {session_id}")
        raise HTTPException(status_code=404, detail="Audio file not found")

    file_path = AUDIO_STORAGE_PATH / session_id / f"{message_id}.mp3"

    if not file_path.exists():
        logger.info(f"Audio file not found: {file_path}")
        raise HTTPException(
            status_code=404,
            detail=f"Audio file not found for session {session_id}, message {message_id}",
        )

    if not file_path.is_file():
        logger.warning(f"Path is not a file: {file_path}")
        raise HTTPException(status_code=404, detail="Invalid file path")

    try:
        resolved_path = file_path.resolve()
        storage_base = AUDIO_STORAGE_PATH.resolve()
        if not str(resolved_path).startswith(str(storage_base)):
            logger.error(f"Path traversal attempt detected: {file_path} -> {resolved_path}")
            raise HTTPException(status_code=400, detail="Invalid file path")
    except Exception as e:
        logger.error(f"Error resolving path {file_path}: {e}")
        raise HTTPException(status_code=400, detail="Invalid file path")

    logger.info(f"Serving audio file: {file_path}")
    return FileResponse(path=str(file_path), media_type="audio/mpeg", filename=f"{message_id}.mp3")
