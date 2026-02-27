"""
WebSocket Endpoint - Main real-time communication handler.

Message Flow:
    Client → Server:
        audio_chunk  : raw audio bytes (base64)
        audio_end    : signals end of recording
        text_input   : direct text message
        ping         : heartbeat
        abort        : cancel current pipeline run

    Server → Client:
        ready        : connection established
        status       : avatar state change
        transcript   : ASR result
        llm_start    : LLM started thinking
        llm_chunk    : streaming token
        llm_end      : LLM done
        tts_start    : TTS starting for a sentence
        tts_chunk    : audio data (base64)
        tts_end      : TTS done
        visemes      : lip sync data
        pong         : heartbeat reply
        error        : something went wrong
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger
from pydantic import BaseModel, ValidationError

from app.schemas.audio import AudioBuffer
from app.schemas.ws_messages import (
    AvatarStatus,
    ChatAbort,
    ChatUserMessage,
    ClientMessageType,
    ServerMessage,
    ServerMessageType,
    TTSRequest,
    VisemeEvent,
    VisemesData,
    # New protocol message schemas
    make_error,
    make_error_msg,
    make_llm_chunk_msg,
    make_status_msg,
    make_transcript_msg,
    make_tts_chunk_msg,
    make_visemes_msg,
)
from app.services.pipeline.events import PipelineEvent, PipelineEventType
from app.services.pipeline.session_manager import Session

# Constants
MAX_AUDIO_BUFFER_SIZE = 24 * 1024 * 1024  # 24 MB
HEARTBEAT_INTERVAL = 30  # seconds
HEARTBEAT_TIMEOUT = 90  # seconds


def validate_message(raw_message: dict) -> ChatUserMessage | ChatAbort | TTSRequest:
    """
    Validate and parse incoming WebSocket message using Pydantic schemas.

    Preconditions:
    - raw_message is dict with 'type' and 'data' keys

    Postconditions:
    - Returns validated Pydantic model instance
    - Raises ValidationError if invalid

    Args:
        raw_message: Dictionary containing 'type' and 'data' fields

    Returns:
        Validated message object (ChatUserMessage, ChatAbort, or TTSRequest)

    Raises:
        ValidationError: If message format is invalid
        ValueError: If message type is unknown
    """
    if not isinstance(raw_message, dict):
        raise ValidationError("Message must be a dictionary")

    if "type" not in raw_message:
        raise ValueError("Message missing 'type' field")

    msg_type = raw_message.get("type")
    msg_data = raw_message.get("data", {})

    # Route to appropriate Pydantic model based on type
    match msg_type:
        case "chat.user_message":
            return ChatUserMessage(**msg_data)
        case "chat.abort":
            return ChatAbort(**msg_data)
        case "tts.request":
            return TTSRequest(**msg_data)
        case _:
            raise ValueError(f"Unknown message type: {msg_type}")


class WebSocketHandler:
    """
    Handles a single WebSocket connection.
    One instance per connected client.
    """

    def __init__(self, websocket: WebSocket, session: Session):
        self.ws = websocket
        self.session = session
        self.pipeline = session.pipeline

        # Background tasks
        self._pipeline_task: asyncio.Task | None = None
        self._heartbeat_task: asyncio.Task | None = None

        # Connection state
        self._connected = True
        self._last_pong_time = time.time()

        logger.info(
            f"WebSocketHandler created | "
            f"session={session.session_id} | "
            f"avatar={session.avatar_id}"
        )

    async def run(self) -> None:
        """
        Main connection loop:
        1. Send READY message
        2. Start ping/pong background task
        3. Listen for incoming messages
        """
        try:
            # Send ready signal with session info
            await self._send(
                ServerMessage(
                    type=ServerMessageType.READY,
                    data={
                        "session_id": self.session.session_id,
                        "avatar_id": self.session.avatar_id,
                        "message": "Connected and ready",
                        "timestamp": time.time(),
                    },
                )
            )

            logger.info(f"[WS] Ready message sent | session={self.session.session_id}")
        except Exception as e:
            logger.error(f"[WS] Failed to send ready message: {e}")
            self._connected = False
            return

        # Start heartbeat ping/pong task
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        # Audio buffer for current recording
        audio_buffer = AudioBuffer()

        try:
            while self._connected:
                try:
                    # Wait for message with timeout to keep ping task alive
                    raw = await asyncio.wait_for(
                        self.ws.receive_text(), timeout=1.0  # short timeout so ping loop can run
                    )
                    await self._route_message(raw, audio_buffer)
                except asyncio.TimeoutError:
                    # No message received, continue (ping loop handles keepalive)
                    continue
                except WebSocketDisconnect:
                    logger.info(f"[WS] Client disconnected | session={self.session.session_id}")
                    break
                except Exception as e:
                    logger.error(f"[WS] Error receiving message: {e}")
                    await self._safe_send(
                        make_error_msg(code="INTERNAL_ERROR", message="Error processing message")
                    )
        finally:
            await self._cleanup()

    async def _heartbeat_loop(self) -> None:
        """
        Background task: send periodic pings to keep connection alive.
        
        Note: This is a one-way heartbeat (server -> client).
        The client doesn't need to respond. If the connection is broken,
        the send will fail and we'll close the connection.

        Preconditions:
        - self._connected is True

        Postconditions:
        - Pings are sent at HEARTBEAT_INTERVAL
        - Connection is closed if send fails
        """
        # Initialize last_pong_time to prevent immediate timeout on connection
        self._last_pong_time = time.time()
        
        while self._connected:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            if not self._connected:
                break

            # Send ping (one-way heartbeat)
            try:
                await self._send(
                    ServerMessage(type=ServerMessageType.PONG, data={"timestamp": time.time()})
                )
                logger.debug(f"Heartbeat ping sent | session={self.session.session_id}")
            except Exception as e:
                logger.warning(f"Heartbeat ping failed (connection likely closed): {e}")
                self._connected = False
                break

    async def _route_message(self, raw: str, audio_buffer: AudioBuffer) -> None:
        """Parse incoming JSON and route to appropriate handler (supports both old and new protocols)."""
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.warning(f"Invalid JSON: {raw[:100]} | {e}")
            await self._safe_send(
                make_error_msg(code="INVALID_MESSAGE", message="Invalid JSON format")
            )
            return

        msg_type_str = data.get("type", "")
        
        # Check if this is a new protocol message (contains dots like "chat.user_message")
        if "." in msg_type_str:
            # Route to new protocol handler
            await self._route_validated_message(raw)
            return
        
        # Handle old protocol messages
        try:
            msg_type = ClientMessageType(msg_type_str)
        except ValueError as e:
            logger.warning(f"Unknown message type: {msg_type_str} | {e}")
            await self._safe_send(
                make_error_msg(code="INVALID_MESSAGE", message=f"Unknown message type: {msg_type_str}")
            )
            return

        self.session.touch()
        logger.debug(f"WS message | type={msg_type.value}")

        match msg_type:
            case ClientMessageType.AUDIO_CHUNK:
                await self._handle_audio_chunk(data, audio_buffer)
            case ClientMessageType.AUDIO_END:
                await self._handle_audio_end(data, audio_buffer)
            case ClientMessageType.TEXT_INPUT:
                await self._handle_text_input(data)
            case ClientMessageType.PING:
                await self._handle_ping()
            case ClientMessageType.ABORT:
                await self._handle_abort(data)
            case _:
                logger.warning(f"Unknown message type: {msg_type}")
                await self._safe_send(
                    make_error_msg(
                        code="UNKNOWN_TYPE", message=f"Unknown message type: {msg_type.value}"
                    )
                )

    async def _route_validated_message(self, raw: str) -> None:
        """
        Parse and validate incoming message using new protocol schemas.

        This method handles the new protocol messages (chat.user_message, chat.abort, tts.request)
        with strict Pydantic validation.
        """
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.warning(f"Invalid JSON: {raw[:100]} | {e}")
            await self._safe_send_error(code="INVALID_MESSAGE", message="Invalid JSON format")
            return

        # Validate message using Pydantic schemas
        try:
            validated_msg = validate_message(data)
        except ValidationError as e:
            logger.warning(f"Message validation failed: {e}")
            await self._safe_send_error(
                code="INVALID_MESSAGE", message=f"Message validation failed: {e!s}"
            )
            return
        except ValueError as e:
            logger.warning(f"Unknown message type: {e}")
            await self._safe_send_error(code="UNKNOWN_TYPE", message=str(e))
            return

        # Session already touched in _route_message, so don't touch again

        # Route to appropriate handler based on validated message type
        try:
            if isinstance(validated_msg, ChatUserMessage):
                await self._handle_chat_user_message(validated_msg)
            elif isinstance(validated_msg, ChatAbort):
                await self._handle_chat_abort(validated_msg)
            elif isinstance(validated_msg, TTSRequest):
                await self._handle_tts_request(validated_msg)
            else:
                logger.error(f"Unhandled validated message type: {type(validated_msg)}")
        except Exception as e:
            logger.error(f"Error handling message: {e}")
            await self._safe_send_error(code="INTERNAL_ERROR", message="Error processing message")

    async def _handle_audio_chunk(self, data: dict, audio_buffer: AudioBuffer) -> None:
        """Store base64 audio chunk into buffer."""
        chunk_b64 = data.get("data", {}).get("chunk")
        if not chunk_b64:
            logger.warning("audio_chunk missing 'chunk' field")
            return

        try:
            chunk_bytes = base64.b64decode(chunk_b64)
        except Exception as e:
            logger.warning(f"Failed to decode audio chunk: {e}")
            await self._safe_send(
                make_error_msg(code="INVALID_AUDIO", message="Failed to decode audio chunk")
            )
            return

        # Prevent buffer overflow
        if audio_buffer.total_size + len(chunk_bytes) > MAX_AUDIO_BUFFER_SIZE:
            logger.warning("Audio buffer overflow, clearing")
            audio_buffer.clear()
            await self._safe_send(
                make_error_msg(code="AUDIO_TOO_LARGE", message="Audio exceeds maximum allowed size")
            )
            return

        audio_buffer.add_chunk(chunk_bytes)

        logger.debug(
            f"Audio chunk | size={len(chunk_bytes)} | "
            f"total={audio_buffer.total_size} | chunks={audio_buffer.chunk_count}"
        )

    async def _handle_audio_end(self, data: dict, audio_buffer: AudioBuffer) -> None:
        """Audio recording finished → start pipeline."""
        if audio_buffer.is_empty:
            logger.warning("audio_end with empty buffer")
            await self._safe_send(make_error_msg(code="EMPTY_AUDIO", message="No audio received"))
            return

        # Cancel any ongoing pipeline
        await self._cancel_pipeline()

        # Take a snapshot and clear buffer
        snapshot = AudioBuffer(
            chunks=list(audio_buffer.chunks),
            format=audio_buffer.format,
            total_size=audio_buffer.total_size,
        )
        audio_buffer.clear()

        logger.info(
            f"Starting audio pipeline | chunks={snapshot.chunk_count} | size={snapshot.total_size}"
        )

        self._pipeline_task = asyncio.create_task(
            self._run_pipeline_audio(snapshot), name=f"pipeline_audio_{self.session.session_id}"
        )

    async def _handle_text_input(self, data: dict) -> None:
        """Direct text input → start pipeline (skip ASR)."""
        text = data.get("data", {}).get("text", "").strip()
        if not text:
            await self._safe_send(make_error_msg(code="EMPTY_TEXT", message="Empty text input"))
            return

        # Cancel any ongoing pipeline
        await self._cancel_pipeline()

        logger.info(f"Starting text pipeline | text='{text[:60]}'")

        self._pipeline_task = asyncio.create_task(
            self._run_pipeline_text(text), name=f"pipeline_text_{self.session.session_id}"
        )

    async def _handle_ping(self) -> None:
        """
        Respond to client ping and update last_pong_time.

        This updates the heartbeat timeout tracking to indicate the client is still alive.
        """
        self._last_pong_time = time.time()
        await self._send(
            ServerMessage(type=ServerMessageType.PONG, data={"timestamp": time.time()})
        )
        logger.debug(f"Pong sent | session={self.session.session_id}")

    async def _handle_abort(self, data: dict | None = None) -> None:
        """
        Client requested abort (legacy protocol).

        Cancels the current pipeline and returns to idle state.
        For new protocol, use _handle_chat_abort() instead.
        """
        message_id = None
        if data and "data" in data:
            message_id = data["data"].get("message_id")

        logger.info(f"Abort received | session={self.session.session_id} | message_id={message_id}")

        # Cancel the pipeline
        await self._cancel_pipeline()

        # Send idle status back to client
        await self._safe_send(make_status_msg(AvatarStatus.IDLE))

    # ── New Protocol Message Handlers ─────────────────────────────────────────

    async def _handle_chat_user_message(self, msg: ChatUserMessage) -> None:
        """
        Handle validated chat.user_message from new protocol.

        Starts the conversation pipeline with the user's text input using the new
        process_message method which handles TTS and viseme generation.
        """
        logger.info(
            f"Chat user message | session={msg.session_id or self.session.session_id} | "
            f"message_id={msg.message_id} | text='{msg.text[:60]}'"
        )

        # Cancel any ongoing pipeline
        await self._cancel_pipeline()

        # Use session_id from message or fall back to session's session_id
        session_id = msg.session_id or self.session.session_id

        # Start new protocol pipeline with process_message
        self._pipeline_task = asyncio.create_task(
            self.pipeline.process_message(
                message_id=msg.message_id,
                text=msg.text,
                session_id=session_id,
                send_callback=self._send_protocol_message,
            ),
            name=f"pipeline_message_{session_id}",
        )

    async def _handle_chat_abort(self, msg: ChatAbort) -> None:
        """
        Handle validated chat.abort from new protocol.

        Cancels the current generation for the specified message_id.
        """
        logger.info(f"Chat abort | session={msg.session_id} | message_id={msg.message_id}")
        await self._cancel_pipeline()

        # Send idle status back to client
        await self._safe_send(make_status_msg(AvatarStatus.IDLE))

    async def _handle_tts_request(self, msg: TTSRequest) -> None:
        """
        Handle validated tts.request from new protocol.

        Generates TTS audio for the provided text without LLM generation.
        """
        logger.info(
            f"TTS request | session={msg.session_id} | message_id={msg.message_id} | "
            f"text='{msg.text[:60]}' | voice={msg.voice}"
        )

        # Cancel any ongoing pipeline
        await self._cancel_pipeline()

        # TODO: Implement standalone TTS generation
        # For now, send error indicating this is not yet implemented
        await self._safe_send_error(
            code="NOT_IMPLEMENTED", message="Standalone TTS requests are not yet implemented"
        )

    async def _safe_send_error(
        self,
        code: str,
        message: str,
        session_id: Optional[str] = None,
        message_id: Optional[str] = None,
        details: Optional[dict] = None,
    ) -> None:
        """
        Send error message using new protocol ErrorMessage schema.

        This is a helper for sending validated error messages.
        """
        error_msg = make_error(
            code=code,
            message=message,
            session_id=session_id or self.session.session_id,
            message_id=message_id,
            details=details,
        )

        # Convert to ServerMessage format for sending
        server_msg = ServerMessage(
            type=ServerMessageType.ERROR, data=error_msg.model_dump(exclude_none=True)
        )

        await self._safe_send(server_msg)

    # ── Pipeline Runners ──────────────────────────────────────────────────────

    async def _run_pipeline_audio(self, audio_buffer: AudioBuffer) -> None:
        """Run pipeline with audio input and forward events."""
        try:
            async for event in self.pipeline.process_audio(audio_buffer):
                if not self._connected:
                    break
                await self._forward_pipeline_event(event)
        except asyncio.CancelledError:
            logger.info("Pipeline audio cancelled")
            await self._safe_send(make_status_msg(AvatarStatus.IDLE))
        except Exception as e:
            logger.error(f"Pipeline audio error: {e}")
            await self._safe_send(
                make_error_msg(code="PIPELINE_ERROR", message="An error occurred during processing")
            )
            await self._safe_send(make_status_msg(AvatarStatus.IDLE))

    async def _run_pipeline_text(self, text: str) -> None:
        """Run pipeline with text input and forward events."""
        try:
            async for event in self.pipeline.process_text(text):
                if not self._connected:
                    break
                await self._forward_pipeline_event(event)
        except asyncio.CancelledError:
            logger.info("Pipeline text cancelled")
            await self._safe_send(make_status_msg(AvatarStatus.IDLE))
        except Exception as e:
            logger.error(f"Pipeline text error: {e}")
            await self._safe_send(
                make_error_msg(code="PIPELINE_ERROR", message="An error occurred during processing")
            )
            await self._safe_send(make_status_msg(AvatarStatus.IDLE))

    # ── Event Forwarding ──────────────────────────────────────────────────────

    async def _forward_pipeline_event(self, event: PipelineEvent) -> None:
        """Convert PipelineEvent to WebSocket message and send."""
        match event.type:
            case PipelineEventType.PROCESSING:
                await self._send(make_status_msg(AvatarStatus.PROCESSING))
            case PipelineEventType.THINKING:
                await self._send(make_status_msg(AvatarStatus.THINKING))
            case PipelineEventType.SPEAKING:
                await self._send(make_status_msg(AvatarStatus.SPEAKING))
            case PipelineEventType.IDLE | PipelineEventType.ABORT:
                await self._send(make_status_msg(AvatarStatus.IDLE))

            case PipelineEventType.TRANSCRIPT:
                await self._send(
                    make_transcript_msg(text=event.data.get("text", ""), is_final=True)
                )

            case PipelineEventType.LLM_TOKEN:
                token = event.data.get("token", "")
                if token:
                    await self._send(make_llm_chunk_msg(token))

            case PipelineEventType.LLM_DONE:
                await self._send(ServerMessage(type=ServerMessageType.LLM_END, data={}))

            case PipelineEventType.TTS_VISEMES:
                raw_events = event.data.get("events", [])
                audio_dur = event.data.get("audio_duration_ms", 0.0)
                sent_idx = event.data.get("sentence_index", 0)

                viseme_objs = [
                    VisemeEvent(
                        offset_ms=v["offset_ms"],
                        viseme_id=v["viseme_id"],
                        duration_ms=v["duration_ms"],
                    )
                    for v in raw_events
                ]

                await self._send(
                    make_visemes_msg(
                        VisemesData(
                            events=viseme_objs,
                            audio_duration_ms=audio_dur,
                        )
                    )
                )

            case PipelineEventType.TTS_AUDIO:
                audio_b64 = event.data.get("audio", "")
                chunk_idx = event.data.get("chunk_index", 0)

                if chunk_idx == 0:
                    # First chunk → send TTS_START
                    await self._send(
                        ServerMessage(
                            type=ServerMessageType.TTS_START,
                            data={"sentence_index": event.data.get("sentence_index", 0)},
                        )
                    )

                await self._send(
                    make_tts_chunk_msg(
                        audio_b64=audio_b64,
                        chunk_index=chunk_idx,
                    )
                )

            case PipelineEventType.TTS_DONE:
                await self._send(ServerMessage(type=ServerMessageType.TTS_END, data={}))

            case PipelineEventType.ERROR:
                await self._send(
                    make_error_msg(
                        code=event.data.get("code", "UNKNOWN_ERROR"),
                        message=event.data.get("message", "Unknown error"),
                    )
                )

            case _:
                logger.debug(f"Unhandled pipeline event: {event.type}")

    # ── Send Helpers ──────────────────────────────────────────────────────────

    async def _send(self, message: ServerMessage) -> None:
        """Send message (raises exception on failure)."""
        await self.ws.send_text(message.to_json())

    async def _safe_send(self, message: ServerMessage) -> None:
        """Send message, ignore errors (used during cleanup)."""
        if not self._connected:
            return
        try:
            await self.ws.send_text(message.to_json())
        except Exception:
            pass

    async def _send_protocol_message(self, message: BaseModel) -> None:
        """
        Send new protocol message (Pydantic model) to client.

        This is used as the send_callback for process_message().
        Converts Pydantic models to JSON and sends via WebSocket.

        Args:
            message: Pydantic message model (ChatDelta, ChatFinal, PipelineState, etc.)
        """
        if not self._connected:
            return

        try:
            # Get the message type from the model class name
            # e.g., ChatDelta -> chat.delta, PipelineState -> pipeline.state, TTSReady -> tts.ready
            class_name = message.__class__.__name__

            # Convert CamelCase to snake_case with dots
            # Handle consecutive capitals correctly (TTS -> tts, not t.t.s)
            import re

            # Insert underscore before uppercase letters that follow lowercase letters or digits
            # This handles: ChatDelta -> Chat_Delta, TTSReady -> TTS_Ready
            snake_case = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", class_name)
            
            # Insert underscore before uppercase letters that are followed by lowercase letters
            # This handles: TTSReady -> TTS_Ready (already done), HTTPSConnection -> HTTPS_Connection
            snake_case = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", snake_case)
            
            # Convert to lowercase and replace underscores with dots
            message_type = snake_case.lower().replace("_", ".")

            # Create envelope with type and data
            envelope = {
                "type": message_type,
                "data": message.model_dump(exclude_none=True),
            }

            await self.ws.send_json(envelope)

        except Exception as e:
            logger.error(f"Failed to send protocol message: {e}")
            # Don't raise - process_message should continue

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def _cancel_pipeline(self) -> None:
        """Cancel any running pipeline task."""
        if self._pipeline_task and not self._pipeline_task.done():
            self.pipeline.abort()
            self._pipeline_task.cancel()
            try:
                await self._pipeline_task
            except asyncio.CancelledError:
                pass
            logger.debug("Pipeline task cancelled")
        self._pipeline_task = None

    async def _cleanup(self) -> None:
        """Clean up resources on disconnect."""
        self._connected = False
        await self._cancel_pipeline()

        if self._heartbeat_task and not self._heartbeat_task.done():
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass

        logger.info(f"Cleanup complete | session={self.session.session_id}")
