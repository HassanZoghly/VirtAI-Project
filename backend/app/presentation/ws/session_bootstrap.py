import asyncio

from fastapi import WebSocket
from loguru import logger

from app.application.chat.session_manager import Session, SessionManager
from app.presentation.ws.connection_manager import WSConnectionManager


class SessionBootstrap:
    """Handles WebSocket session initialization."""

    def __init__(self, session_manager: SessionManager, connection_manager: WSConnectionManager):
        self.session_manager = session_manager
        self.connection_manager = connection_manager

    async def ensure_session(
        self,
        websocket: WebSocket,
        user_id: str,
        avatar_id: str,
        voice_id: str,
        requested_session_id: str | None,
        family_id: str | None,
        session_pending: bool,
    ) -> tuple[Session, bool]:
        """Registers the websocket to an existing session. Fails if no session_id provided."""
        if not requested_session_id:
            raise ValueError("WS lazy session creation is disabled. session_id is required.")

        session = await self.session_manager.connect_existing_session(
            session_id=requested_session_id,
            user_id=user_id,
            avatar_id=avatar_id,
            voice_id=voice_id,
        )

        if not session:
            logger.warning(f"[WS] Session {requested_session_id} not found or does not belong to user. Creating new session.")
            session = await self.session_manager.create_session(
                user_id=user_id,
                session_id=requested_session_id,
                avatar_id=avatar_id,
                voice_id=voice_id,
            )

        # Set cleanup handler to clear WS memory when session is permanently destroyed
        session.on_cleanup = lambda sid=session.session_id: asyncio.create_task(
            self.connection_manager.cleanup_session(sid)
        )

        await self.connection_manager.register(
            session.session_id, websocket, user_id=user_id, family_id=family_id
        )
        logger.info(f"[WS] Session registered | session={session.session_id}")
        return session, False
