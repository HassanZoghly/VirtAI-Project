import json
import re
from fastapi import WebSocket
from loguru import logger
from pydantic import BaseModel

from app.presentation.ws.connection_manager import WSConnectionManager
from app.schemas.ws_messages import ServerMessage, ServerMessageType, make_error


class OutboundSender:
    """Handles sending outbound messages via WebSocket."""
    
    _PROTOCOL_MESSAGE_TYPES: dict[str, str] = {}

    def __init__(self, websocket: WebSocket, connection_manager: WSConnectionManager):
        self.ws = websocket
        self.connection_manager = connection_manager

    async def send(self, message: ServerMessage, session_id: str | None, session_pending: bool) -> None:
        """Send message (raises exception on failure)."""
        envelope = {
            "type": message.type.value,
            "data": message.data,
        }
        if session_pending or not session_id:
            serialized = json.dumps(envelope)
            await self.ws.send_text(serialized)
            return

        serialized = await self.connection_manager.stamp_and_record(
            session_id, envelope
        )
        await self.ws.send_text(serialized)

    async def send_binary(self, data: bytes) -> None:
        """Send raw binary data to the client over WebSocket."""
        await self.ws.send_bytes(data)

    async def safe_send(self, message: ServerMessage, session_id: str | None, session_pending: bool, connected: bool) -> None:
        """Send message, ignore errors (used during cleanup)."""
        if not connected:
            return
        try:
            await self.send(message, session_id, session_pending)
        except Exception:
            pass

    async def safe_send_error(
        self,
        code: str,
        message: str,
        session_id: str | None,
        session_pending: bool,
        connected: bool,
        message_id: str | None = None,
        details: dict | None = None,
    ) -> None:
        """Send error message using new protocol ErrorMessage schema."""
        error_msg = make_error(
            code=code,
            message=message,
            session_id=session_id,
            message_id=message_id,
            details=details,
        )

        server_msg = ServerMessage(
            type=ServerMessageType.ERROR, data=error_msg.model_dump(exclude_none=True)
        )

        await self.safe_send(server_msg, session_id, session_pending, connected)

    async def send_protocol_message(self, message: BaseModel, session_id: str | None, session_pending: bool, connected: bool) -> None:
        """Send new protocol message (Pydantic model) to client."""
        if not connected:
            return

        try:
            class_name = message.__class__.__name__

            if class_name not in self._PROTOCOL_MESSAGE_TYPES:
                snake_case = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", class_name)
                snake_case = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", snake_case)
                self._PROTOCOL_MESSAGE_TYPES[class_name] = snake_case.lower().replace("_", ".")

            message_type = self._PROTOCOL_MESSAGE_TYPES[class_name]

            envelope = {
                "type": message_type,
                "data": message.model_dump(exclude_none=True),
            }

            if session_pending or not session_id:
                serialized = json.dumps(envelope)
                await self.ws.send_text(serialized)
                return

            serialized = await self.connection_manager.stamp_and_record(
                session_id, envelope
            )
            await self.ws.send_text(serialized)

        except Exception as e:
            logger.error(f"Failed to send protocol message: {e}")
