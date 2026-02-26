"""
API v1 Router - registers all endpoints.
"""
from fastapi import APIRouter, WebSocket, Depends, WebSocketDisconnect
from loguru import logger

from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.websocket import WebSocketHandler
from app.api.v1.dependencies import get_session_manager
from app.core.config import get_settings

settings = get_settings()

router = APIRouter(prefix="/api/v1")

# HTTP Endpoints
router.include_router(health_router)


@router.websocket("/ws/{avatar_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    avatar_id: str,
    session_manager=Depends(get_session_manager),
):
    """
    WebSocket endpoint for real-time communication.
    URL: ws://localhost:8000/api/v1/ws/{avatar_id}
    Supported avatar_id: avatar1, avatar2, avatar3
    """
    # Validate avatar_id
    valid_avatars = {"avatar1", "avatar2", "avatar3"}
    if avatar_id not in valid_avatars:
        await websocket.close(code=4004, reason="Invalid avatar ID")
        return

    # Accept connection
    await websocket.accept()
    logger.info(f"WebSocket connected | avatar={avatar_id} | client={websocket.client}")

    # Create session
    session = session_manager.create_session(avatar_id=avatar_id)

    # Create handler and run
    handler = WebSocketHandler(websocket=websocket, session=session)

    try:
        await handler.run()
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected | session={session.session_id}")
    except Exception as e:
        logger.error(f"WebSocket error | session={session.session_id} | {e}")
    finally:
        session_manager.remove_session(session.session_id)
        logger.info(f"Session cleaned up | id={session.session_id}")