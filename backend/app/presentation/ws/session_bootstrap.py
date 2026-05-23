from loguru import logger
from fastapi import WebSocket
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
        """Creates or registers the session if pending."""
        if not session_pending:
            # Assume session is already created and managed outside, return as is (but we need the current session)
            # Actually, the caller will handle if it's already created.
            raise ValueError("ensure_session called but session is not pending")

        session = await self.session_manager.create_session(
            user_id=user_id,
            session_id=requested_session_id,
            avatar_id=avatar_id,
            voice_id=voice_id,
        )
        
        await self.connection_manager.register(
            session.session_id, websocket, user_id=user_id, family_id=family_id
        )
        logger.info(f"[WS] Lazy session created | session={session.session_id}")
        return session, False
