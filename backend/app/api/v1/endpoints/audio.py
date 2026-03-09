"""
Audio file serving endpoint

Serves audio files from session storage with strict security validation
to prevent directory traversal attacks.
"""

import re
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, HTTPException
from fastapi import Path as PathParam
from fastapi.responses import FileResponse
from loguru import logger

router = APIRouter()

# Storage base path (relative to backend directory)
AUDIO_STORAGE_PATH = Path("backend/.data/sessions")


def is_safe_path_component(component: str) -> bool:
    """
    Validate that a path component is safe (no path traversal)

    Args:
        component: Path component to validate (session_id or message_id)

    Returns:
        True if safe, False otherwise
    """
    if not component:
        return False

    # Check for path traversal attempts
    if ".." in component or "/" in component or "\\" in component:
        return False

    # Check for valid characters (alphanumeric, dash, underscore)
    # This matches UUID format and common message ID patterns
    if not re.match(r"^[a-zA-Z0-9_-]+$", component):
        return False

    return True


@router.get(
    "/audio/{session_id}/{message_id}.mp3",
    response_class=FileResponse,
    responses={
        200: {
            "description": "Audio file",
            "content": {"audio/mpeg": {}},
        },
        404: {"description": "Audio file not found"},
        400: {"description": "Invalid session_id or message_id"},
    },
)
async def get_audio_file(
    session_id: Annotated[str, PathParam(description="Session identifier")],
    message_id: Annotated[str, PathParam(description="Message identifier")],
) -> FileResponse:
    """
    Serve audio file for a specific message in a session.

    Security features:
    - Validates session_id and message_id to prevent directory traversal
    - Only serves files from AUDIO_STORAGE_PATH
    - Returns 404 if file doesn't exist
    - Returns proper MIME type (audio/mpeg)

    Args:
        session_id: Session identifier (validated for safety)
        message_id: Message identifier (validated for safety)

    Returns:
        FileResponse with audio/mpeg content

    Raises:
        HTTPException: 400 if invalid path components, 404 if file not found
    """
    # Validate path components to prevent directory traversal
    if not is_safe_path_component(session_id):
        logger.warning(f"Invalid session_id attempted: {session_id}")
        raise HTTPException(status_code=400, detail=f"Invalid session_id format: {session_id}")

    if not is_safe_path_component(message_id):
        logger.warning(f"Invalid message_id attempted: {message_id}")
        raise HTTPException(status_code=400, detail=f"Invalid message_id format: {message_id}")

    # Construct file path
    file_path = AUDIO_STORAGE_PATH / session_id / f"{message_id}.mp3"

    # Verify file exists
    if not file_path.exists():
        logger.info(f"Audio file not found: {file_path}")
        raise HTTPException(
            status_code=404,
            detail=f"Audio file not found for session {session_id}, message {message_id}",
        )

    # Verify it's a file (not a directory)
    if not file_path.is_file():
        logger.warning(f"Path is not a file: {file_path}")
        raise HTTPException(status_code=404, detail="Invalid file path")

    # Additional security: verify the resolved path is still within storage directory
    try:
        resolved_path = file_path.resolve()
        storage_base = AUDIO_STORAGE_PATH.resolve()

        # Check if resolved path is within storage directory
        if not str(resolved_path).startswith(str(storage_base)):
            logger.error(f"Path traversal attempt detected: {file_path} -> {resolved_path}")
            raise HTTPException(status_code=400, detail="Invalid file path")
    except Exception as e:
        logger.error(f"Error resolving path {file_path}: {e}")
        raise HTTPException(status_code=400, detail="Invalid file path")

    logger.info(f"Serving audio file: {file_path}")

    # Serve file with proper MIME type
    return FileResponse(
        path=str(file_path),
        media_type="audio/mpeg",
        filename=f"{message_id}.mp3",
    )
