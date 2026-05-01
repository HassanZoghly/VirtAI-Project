"""
API v1 Router - registers all endpoints.

Canonical location: app.presentation.http.v1.router
"""

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from loguru import logger

from app.infrastructure.cache.rate_limiter import check_rate_limit
from app.presentation.http.v1.dependencies import get_session_manager, get_ws_connection_manager
from app.presentation.http.v1.endpoints.audio import router as audio_router
from app.presentation.http.v1.endpoints.auth import router as auth_router
from app.presentation.http.v1.endpoints.chat import router as chat_router
from app.presentation.http.v1.endpoints.health import router as health_router
from app.presentation.ws.connection_manager import WSConnectionManager
from app.presentation.ws.gateway import WebSocketHandler
from app.shared.config import get_settings
from app.shared.security import verify_token

settings = get_settings()

router = APIRouter(prefix="/api/v1")

# HTTP Endpoints
router.include_router(health_router)
router.include_router(audio_router)
router.include_router(chat_router, prefix="/chat", tags=["chat"])
router.include_router(auth_router, prefix="/auth", tags=["auth"])


@router.websocket("/ws/{avatar_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    avatar_id: str,
    token: str | None = Query(default=None),
    voice: str = Query(default=""),
    session_id: str | None = Query(default=None),
    resume: bool = Query(default=False),
    last_seq: int = Query(default=0, ge=0),
    session_manager=Depends(get_session_manager),
    connection_manager: WSConnectionManager = Depends(get_ws_connection_manager),
):
    """
    WebSocket endpoint for real-time communication.
    URL: ws://localhost:8000/api/v1/ws/{avatar_id}?voice=aria
    Supported avatar_id: avatar1, avatar2, avatar3
    """
    voice_id = voice or settings.TTS_VOICE
    client_ip = websocket.client.host if websocket.client else "unknown"
    logger.info(
        f"[WS] Connection attempt | avatar={avatar_id} | voice={voice_id} | client={websocket.client} | "
        f"resume={resume} | session_id={session_id}"
    )

    # Per-IP connection throttling (best effort, fail-open handled by helper)
    allowed = await check_rate_limit(
        identifier=f"ws:connect:{client_ip}",
        limit=settings.RATE_LIMIT_CONNECTIONS_PER_IP,
        window=60,
    )
    if not allowed:
        await websocket.close(code=4408, reason="Too many connection attempts")
        return

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

    # WebSocket Auth (S1-01)
    if not token:
        logger.warning("[WS] Missing token")
        await websocket.close(code=4401, reason="Missing token")
        return

    verified = verify_token(token, expected_type="access")
    if not verified:
        logger.warning("[WS] Invalid token")
        await websocket.close(code=4401, reason="Invalid token")
        return

    user_id, _ = verified

    # Create or resume session
    resumed = False
    session = None
    try:
        if resume and session_id:
            session = await session_manager.connect_existing_session(session_id)
            if session is None:
                await websocket.close(code=4404, reason="Session not found for resume")
                return
            # Session Fixation (S1-06)
            if session.user_id != user_id:
                logger.warning(
                    f"[WS] Unauthorized session resume attempt by user {user_id} for session {session_id}"
                )
                await websocket.close(code=4403, reason="Unauthorized session resume")
                return
            resumed = True
            logger.info(f"[WS] Session resumed | session_id={session.session_id}")
        else:
            logger.info(
                f"[WS] Lazy session mode | avatar={avatar_id} | voice={voice_id} | session will be created on first message"
            )
    except Exception as e:
        logger.error(f"[WS] Failed to create session: {e}")
        try:
            await websocket.close(code=1011, reason="Failed to create session")
        except:
            pass
        return

    # Create handler and run
    handler = WebSocketHandler(
        websocket=websocket,
        session=session,
        session_manager=session_manager,
        user_id=user_id,
        avatar_id=avatar_id,
        voice_id=voice_id,
        connection_manager=connection_manager,
        resumed=resumed,
        replay_after_seq=last_seq if resumed else 0,
        requested_session_id=session_id if not resumed else None,
    )

    try:
        logger.info(
            f"[WS] Starting handler | session={session.session_id if session else 'pending'}"
        )
        await handler.run()
    except WebSocketDisconnect:
        logger.info(f"[WS] Client disconnected | session={handler.session.session_id or 'pending'}")
    except Exception as e:
        logger.error(
            f"[WS] Handler error | session={handler.session.session_id or 'pending'} | error={e}",
            exc_info=True,
        )
    finally:
        if handler.session.session_id:
            await connection_manager.unregister(handler.session.session_id, websocket)
            session_manager.disconnect_session(handler.session.session_id)
            logger.info(
                f"[WS] Session disconnected (kept for resume) | id={handler.session.session_id}"
            )
