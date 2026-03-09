"""
API v1 Router - registers all endpoints.
"""

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from loguru import logger

from app.api.v1.dependencies import get_session_manager
from app.api.v1.endpoints.audio import router as audio_router
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.websocket import WebSocketHandler
from app.core.config import get_settings

settings = get_settings()

router = APIRouter(prefix="/api/v1")

# HTTP Endpoints
router.include_router(health_router)
router.include_router(audio_router)
router.include_router(auth_router, prefix="/auth", tags=["auth"])


@router.websocket("/ws/{avatar_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    avatar_id: str,
    voice: str = Query(default=""),
    session_manager=Depends(get_session_manager),
):
    """
    WebSocket endpoint for real-time communication.
    URL: ws://localhost:8000/api/v1/ws/{avatar_id}?voice=en-US-AriaNeural
    Supported avatar_id: avatar1, avatar2, avatar3
    """
    voice_id = voice or settings.TTS_VOICE
    logger.info(
        f"[WS] Connection attempt | avatar={avatar_id} | voice={voice_id} | client={websocket.client}"
    )

    # Validate avatar_id
    valid_avatars = set(settings.VALID_AVATAR_IDS)
    if avatar_id not in valid_avatars:
        logger.warning(f"[WS] Invalid avatar_id: {avatar_id}")
        await websocket.close(code=4004, reason="Invalid avatar ID")
        return

    # Accept connection
    try:
        await websocket.accept()
        logger.info(f"[WS] Connection accepted | avatar={avatar_id} | client={websocket.client}")
    except Exception as e:
        logger.error(f"[WS] Failed to accept connection: {e}")
        return

    # Create session (async)
    try:
        session = await session_manager.create_session(avatar_id=avatar_id, voice_id=voice_id)
        logger.info(
            f"[WS] Session created | session_id={session.session_id} | avatar={avatar_id} | voice={voice_id}"
        )
    except Exception as e:
        logger.error(f"[WS] Failed to create session: {e}")
        try:
            await websocket.close(code=1011, reason="Failed to create session")
        except:
            pass
        return

    # Create handler and run
    handler = WebSocketHandler(websocket=websocket, session=session)

    try:
        logger.info(f"[WS] Starting handler | session={session.session_id}")
        await handler.run()
    except WebSocketDisconnect:
        logger.info(f"[WS] Client disconnected | session={session.session_id}")
    except Exception as e:
        logger.error(
            f"[WS] Handler error | session={session.session_id} | error={e}", exc_info=True
        )
    finally:
        session_manager.remove_session(session.session_id)
        logger.info(f"[WS] Session cleaned up | id={session.session_id}")
