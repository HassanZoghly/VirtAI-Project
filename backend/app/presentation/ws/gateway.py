"""
WebSocket Gateway — Main real-time communication handler.

Canonical location: app.presentation.ws.gateway

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
import re
import time
from types import SimpleNamespace

from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger
from pydantic import BaseModel, ValidationError

from app.application.chat.session_manager import Session
from app.domain.chat.entities import PipelineEvent, PipelineEventType
from app.infrastructure.asr.groq_whisper import GroqWhisperASR
from app.presentation.ws.connection_manager import WSConnectionManager
from app.presentation.ws.voice_mode_handler import VoiceModeHandler
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
from app.shared.config import get_settings


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

    def __init__(
        self,
        websocket: WebSocket,
        session: Session | None,
        session_manager,
        user_id: str,
        avatar_id: str,
        voice_id: str,
        connection_manager: WSConnectionManager,
        resumed: bool = False,
        replay_after_seq: int = 0,
        requested_session_id: str | None = None,
    ):
        self.ws = websocket
        self._session_manager = session_manager
        self._user_id = user_id
        self._avatar_id = avatar_id
        self._voice_id = voice_id
        self._session_pending = session is None
        self._requested_session_id = requested_session_id
        self.session = session or SimpleNamespace(
            session_id=requested_session_id or "",
            avatar_id=avatar_id,
            touch=lambda: None,
        )
        self.pipeline = session.pipeline if session is not None else None
        self.connection_manager = connection_manager
        self.resumed = resumed
        self.replay_after_seq = replay_after_seq

        # Background tasks
        self._pipeline_task: asyncio.Task | None = None
        self._heartbeat_task: asyncio.Task | None = None

        # Connection state
        self._connected = True
        self._last_pong_time = time.time()

        # Voice mode handler (lazy initialization)
        self._voice_mode_handler: VoiceModeHandler | None = None

        logger.info(
            f"WebSocketHandler created | "
            f"session={self.session.session_id or 'pending'} | "
            f"avatar={self.session.avatar_id} | "
            f"resumed={resumed} | replay_after_seq={replay_after_seq}"
        )

    async def _ensure_session(self) -> None:
        if not self._session_pending:
            return

        session = await self._session_manager.create_session(
            user_id=self._user_id,
            session_id=self._requested_session_id,
            avatar_id=self._avatar_id,
            voice_id=self._voice_id,
        )
        self.session = session
        self.pipeline = session.pipeline
        self._session_pending = False
        await self.connection_manager.register(session.session_id, self.ws)
        logger.info(f"[WS] Lazy session created | session={session.session_id}")

    async def run(self) -> None:
        """
        Main connection loop:
        1. Send READY message
        2. Start ping/pong background task
        3. Listen for incoming messages
        """
        replay_batch: list[str] = []
        if self.resumed and self.session.session_id:
            await self.connection_manager.register(self.session.session_id, self.ws)
            replay_batch = await self.connection_manager.get_replay_batch(
                self.session.session_id, after_seq=self.replay_after_seq
            )

        try:
            # Send ready signal with session info
            await self._send(
                ServerMessage(
                    type=ServerMessageType.READY,
                    data={
                        "session_id": self.session.session_id or None,
                        "avatar_id": self.session.avatar_id,
                        "message": "Connected and ready",
                        "resumed": self.resumed,
                        "last_seq": (
                            self.connection_manager.latest_sequence(self.session.session_id)
                            if self.session.session_id
                            else 0
                        ),
                        "timestamp": time.time(),
                    },
                )
            )

            logger.info(f"[WS] Ready message sent | session={self.session.session_id or 'pending'}")

            if self.resumed:
                replayed = 0
                for payload in replay_batch:
                    if not self._connected:
                        break
                    try:
                        await self.ws.send_text(payload)
                        replayed += 1
                    except Exception:
                        break
                logger.info(
                    f"[WS] Replay complete | session={self.session.session_id or 'pending'} | replayed={replayed}"
                )
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
                    # Wait for message (text or binary) with timeout to keep ping task alive
                    message = await asyncio.wait_for(
                        self.ws.receive(), timeout=1.0  # short timeout so ping loop can run
                    )

                    # ── Explicit disconnect detection ──────────────────────────
                    # Starlette's receive() can return a raw ASGI disconnect dict
                    # *before* raising WebSocketDisconnect — handle it here so we
                    # never call receive() again after the connection closed.
                    if message.get("type") == "websocket.disconnect":
                        code = message.get("code", 1000)
                        logger.info(
                            f"[WS] Disconnect frame received | "
                            f"session={self.session.session_id} | code={code}"
                        )
                        self._connected = False
                        break

                    # Handle normal message types
                    if "text" in message:
                        # Text frame - route to text message handler
                        await self._route_message(message["text"], audio_buffer)
                    elif "bytes" in message:
                        # Binary frame - route to binary message handler (PCM audio)
                        await self._handle_binary_frame(message["bytes"])
                    else:
                        logger.debug(f"[WS] Unhandled ASGI message type: {message.get('type')}")

                except asyncio.TimeoutError:
                    # No message received, continue (ping loop handles keepalive)
                    continue
                except WebSocketDisconnect as exc:
                    # Raised by Starlette when client disconnects
                    logger.warning(
                        f"[WS] Client disconnected | "
                        f"session={self.session.session_id} | "
                        f"avatar={self.session.avatar_id} | "
                        f"code={exc.code} | "
                        f"voice_mode_active={self._voice_mode_handler is not None} | "
                        f"pipeline_running="
                        f"{self._pipeline_task is not None and not self._pipeline_task.done()}"
                    )

                    # Clear voice mode buffer if active
                    if self._voice_mode_handler is not None:
                        buffer_size = self._voice_mode_handler.audio_pipeline.get_buffer_size()
                        if buffer_size > 0:
                            logger.info(
                                f"[WS] Clearing voice mode buffer on disconnect | "
                                f"session={self.session.session_id} | "
                                f"buffer_size={buffer_size:,}B"
                            )
                        self._voice_mode_handler.audio_pipeline.clear_buffer()

                    self._connected = False
                    break
                except RuntimeError as e:
                    # Starlette raises RuntimeError("Cannot call ...") after disconnect;
                    # treat it the same as a normal disconnect.
                    if "disconnect" in str(e).lower() or "receive" in str(e).lower():
                        logger.warning(
                            f"[WS] RuntimeError after disconnect (suppressed) | "
                            f"session={self.session.session_id} | {e}"
                        )
                        self._connected = False
                        break
                    logger.error(f"[WS] Unexpected RuntimeError: {e}")
                    await self._safe_send(
                        make_error_msg(code="INTERNAL_ERROR", message="Error processing message")
                    )
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

        settings = get_settings()
        while self._connected:
            await asyncio.sleep(settings.WS_HEARTBEAT_INTERVAL)
            if not self._connected:
                break

            if time.time() - self._last_pong_time > settings.WS_HEARTBEAT_TIMEOUT:
                logger.warning(
                    f"[WS] Heartbeat timeout | session={self.session.session_id} | "
                    f"idle_for={time.time() - self._last_pong_time:.1f}s"
                )
                self._connected = False
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

    async def _get_voice_mode_handler(self) -> VoiceModeHandler:
        """
        Get or create VoiceModeHandler for this session.

        Lazy initialization of voice mode handler to avoid creating ASR service
        unless voice mode is actually used.

        Returns:
            VoiceModeHandler instance for this session
        """
        await self._ensure_session()
        if self._voice_mode_handler is None:
            # Initialize ASR service (lazy loading)
            asr_service = GroqWhisperASR()

            # Create voice mode handler
            self._voice_mode_handler = VoiceModeHandler(
                websocket=self.ws,
                session_id=self.session.session_id,
                asr_service=asr_service,
                conversation_pipeline=self.pipeline,
            )

            logger.info(f"VoiceModeHandler created | session={self.session.session_id}")

        return self._voice_mode_handler

    async def _handle_binary_frame(self, pcm_bytes: bytes) -> None:
        """Handle incoming binary frame containing raw PCM audio data.

        Binary frame protocol: [PCM bytes (Int16LE, 16kHz mono)] + [1-byte is_final marker]
        The last byte is a marker: 0x01 = final (VAD detected silence), 0x00 = not final.
        Backward compat: frames with odd byte count (after removing marker) are treated as
        legacy frames with is_final=False.

        Args:
            pcm_bytes: Raw binary frame from WebSocket (PCM + marker byte)
        """
        try:
            # Get or create voice mode handler
            voice_handler = await self._get_voice_mode_handler()

            # Parse is_final marker byte from the end of the frame
            is_final = False
            if len(pcm_bytes) >= 3:
                marker = pcm_bytes[-1]
                pcm_data = pcm_bytes[:-1]
                # Int16 PCM must have even byte count
                if len(pcm_data) % 2 == 0 and marker in (0x00, 0x01):
                    is_final = marker == 0x01
                else:
                    # Legacy frame without marker byte — use full frame
                    pcm_data = pcm_bytes
            else:
                pcm_data = pcm_bytes

            await voice_handler.handle_audio_chunk(pcm_data, is_final=is_final)

        except Exception as e:
            logger.error(f"[WS] Error handling binary frame: {e}")
            await self._safe_send(
                make_error_msg(code="BINARY_FRAME_ERROR", message="Error processing audio data")
            )

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

        # Ignore empty messages (likely keepalive or malformed)
        if not msg_type_str:
            logger.debug(f"Ignoring empty message: {raw[:100]}")
            return

        self.session.touch()
        self._last_pong_time = time.time()

        if msg_type_str == "ws.ack":
            await self._handle_ws_ack(data)
            return

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
                make_error_msg(
                    code="INVALID_MESSAGE", message=f"Unknown message type: {msg_type_str}"
                )
            )
            return

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
            case ClientMessageType.VOICE_MODE_STOP:
                await self._handle_voice_mode_stop(data)
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
        """
        Store base64 audio chunk into buffer.

        This method handles both legacy audio chunks (for old protocol) and
        voice mode audio chunks (for continuous ASR voice mode).

        Voice mode chunks have 'is_final' flag and are routed to VoiceModeHandler.
        Legacy chunks are accumulated in audio_buffer for audio_end processing.
        """
        # Check if this is a voice mode chunk (has is_final flag at top level or in data)
        is_voice_mode = "is_final" in data or "is_final" in data.get("data", {})

        if is_voice_mode:
            # Voice mode JSON audio_chunk is a control signal (actual audio goes via binary frames).
            # Extract is_final and trigger processing of buffered audio if needed.
            voice_handler = await self._get_voice_mode_handler()
            voice_data = data if "is_final" in data else data.get("data", {})
            is_final = voice_data.get("is_final", False)

            if is_final and voice_handler.audio_pipeline.get_buffer_size() > 0:
                logger.debug(f"Voice mode finalize signal | session={self.session.session_id}")
                await voice_handler.process_accumulated_audio()
            else:
                logger.debug(
                    f"Voice mode control message | is_final={is_final} | session={self.session.session_id}"
                )
            return

        # Legacy audio chunk handling (for old protocol)
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
        if audio_buffer.total_size + len(chunk_bytes) > get_settings().MAX_AUDIO_BUFFER_SIZE:
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
        await self._ensure_session()
        await self._cancel_pipeline()

        # Take a snapshot and clear buffer
        snapshot = AudioBuffer(
            chunks=list(audio_buffer.chunks),
            total_size=audio_buffer.total_size,
        )
        audio_buffer.clear()

        logger.info(
            f"Starting audio pipeline | chunks={snapshot.chunk_count} | size={snapshot.total_size}"
        )

        self._pipeline_task = asyncio.create_task(
            self._run_pipeline_audio(snapshot, session_id=self.session.session_id),
            name=f"pipeline_audio_{self.session.session_id}",
        )

    async def _handle_text_input(self, data: dict) -> None:
        """Direct text input → start pipeline (skip ASR)."""
        text = data.get("data", {}).get("text", "").strip()
        if not text:
            await self._safe_send(make_error_msg(code="EMPTY_TEXT", message="Empty text input"))
            return

        # Cancel any ongoing pipeline
        await self._ensure_session()
        await self._cancel_pipeline()

        logger.info(f"Starting text pipeline | text='{text[:60]}'")

        self._pipeline_task = asyncio.create_task(
            self._run_pipeline_text(text, session_id=self.session.session_id),
            name=f"pipeline_text_{self.session.session_id}",
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

    async def _handle_voice_mode_stop(self, data: dict | None = None) -> None:
        """
        Handle voice_mode_stop message from client.

        This is called when the user stops voice mode. It clears the audio buffer
        in the VoiceModeHandler to ensure no partial audio is processed.

        Requirements: 11.1, 11.2, 11.3
        """
        logger.info(f"Voice mode stop received | session={self.session.session_id}")

        # Clear voice mode handler's buffer if it exists
        if self._voice_mode_handler is not None:
            self._voice_mode_handler.audio_pipeline.clear_buffer()
            logger.debug(f"Voice mode buffer cleared | session={self.session.session_id}")

    async def _handle_ws_ack(self, data: dict) -> None:
        """Handle client acknowledgment of received sequence IDs."""
        if self._session_pending or not self.session.session_id:
            return

        ack_data = data.get("data", data)
        raw_last_seq = ack_data.get("last_seq")
        try:
            last_seq = int(raw_last_seq)
        except (TypeError, ValueError):
            logger.debug(
                f"[WS] Ignoring invalid ack payload | session={self.session.session_id} | raw={raw_last_seq}"
            )
            return

        if last_seq < 0:
            return

        trimmed = await self.connection_manager.acknowledge(self.session.session_id, last_seq)
        if trimmed > 0:
            logger.debug(
                f"[WS] Ack processed | session={self.session.session_id} | last_seq={last_seq} | trimmed={trimmed}"
            )

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

        await self._ensure_session()

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
        session_id: str | None = None,
        message_id: str | None = None,
        details: dict | None = None,
    ) -> None:
        """
        Send error message using new protocol ErrorMessage schema.

        This is a helper for sending validated error messages.
        """
        error_msg = make_error(
            code=code,
            message=message,
            session_id=session_id or (self.session.session_id or None),
            message_id=message_id,
            details=details,
        )

        # Convert to ServerMessage format for sending
        server_msg = ServerMessage(
            type=ServerMessageType.ERROR, data=error_msg.model_dump(exclude_none=True)
        )

        await self._safe_send(server_msg)

    # ── Pipeline Runners ──────────────────────────────────────────────────────

    async def _run_pipeline_audio(self, audio_buffer: AudioBuffer, session_id: str | None = None) -> None:
        """Run pipeline with audio input and forward events."""
        try:
            if self.pipeline is None:
                return
            async for event in self.pipeline.process_audio(audio_buffer, session_id=session_id):
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

    async def _run_pipeline_text(self, text: str, session_id: str | None = None) -> None:
        """Run pipeline with text input and forward events."""
        try:
            if self.pipeline is None:
                return
            async for event in self.pipeline.process_text(text, session_id=session_id):
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
        envelope = {
            "type": message.type.value,
            "data": message.data,
        }
        if self._session_pending or not self.session.session_id:
            serialized = json.dumps(envelope)
            await self.ws.send_text(serialized)
            return

        serialized = await self.connection_manager.stamp_and_record(
            self.session.session_id, envelope
        )
        await self.ws.send_text(serialized)

    async def _safe_send(self, message: ServerMessage) -> None:
        """Send message, ignore errors (used during cleanup)."""
        if not self._connected:
            return
        try:
            envelope = {
                "type": message.type.value,
                "data": message.data,
            }
            if self._session_pending or not self.session.session_id:
                serialized = json.dumps(envelope)
                await self.ws.send_text(serialized)
                return

            serialized = await self.connection_manager.stamp_and_record(
                self.session.session_id, envelope
            )
            await self.ws.send_text(serialized)
        except Exception:
            pass

    _PROTOCOL_MESSAGE_TYPES: dict[str, str] = {}

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
            class_name = message.__class__.__name__

            if class_name not in self._PROTOCOL_MESSAGE_TYPES:
                snake_case = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", class_name)
                snake_case = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", snake_case)
                self._PROTOCOL_MESSAGE_TYPES[class_name] = snake_case.lower().replace("_", ".")

            message_type = self._PROTOCOL_MESSAGE_TYPES[class_name]

            # Create envelope with type and data
            envelope = {
                "type": message_type,
                "data": message.model_dump(exclude_none=True),
            }

            if self._session_pending or not self.session.session_id:
                serialized = json.dumps(envelope)
                await self.ws.send_text(serialized)
                return

            serialized = await self.connection_manager.stamp_and_record(
                self.session.session_id, envelope
            )
            await self.ws.send_text(serialized)

        except Exception as e:
            logger.error(f"Failed to send protocol message: {e}")
            # Don't raise - process_message should continue

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def _cancel_pipeline(self) -> None:
        """Cancel any running pipeline task."""
        if self._pipeline_task and not self._pipeline_task.done():
            if self.pipeline is not None:
                self.pipeline.abort()
            self._pipeline_task.cancel()
            try:
                await self._pipeline_task
            except asyncio.CancelledError:
                pass
            logger.debug("Pipeline task cancelled")
        self._pipeline_task = None

    async def _cleanup(self) -> None:
        """Clean up resources on disconnect.

        Comprehensive cleanup with logging for WebSocket disconnection (Requirement 11.1, 11.2).
        Ensures all audio buffers are cleared and resources are freed.
        """
        self._connected = False

        # Log cleanup start with session info
        logger.info(
            f"[WS] Starting cleanup | "
            f"session={self.session.session_id} | "
            f"avatar={self.session.avatar_id}"
        )

        # Cancel pipeline if running
        await self._cancel_pipeline()

        # Cancel heartbeat task
        if self._heartbeat_task and not self._heartbeat_task.done():
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
            logger.debug(f"[WS] Heartbeat task cancelled | session={self.session.session_id}")

        # Clean up voice mode handler if it exists (Requirement 11.2)
        if self._voice_mode_handler is not None:
            try:
                buffer_size = self._voice_mode_handler.audio_pipeline.get_buffer_size()

                if buffer_size > 0:
                    logger.info(
                        f"[WS] Clearing voice mode buffer in cleanup | "
                        f"session={self.session.session_id} | "
                        f"buffer_size={buffer_size:,}B"
                    )
            except (TypeError, AttributeError):
                # Handle mock objects or missing attributes in tests
                pass

            self._voice_mode_handler.audio_pipeline.clear_buffer()
            logger.debug(f"[WS] Voice mode handler cleaned up | session={self.session.session_id}")

        logger.info(f"[WS] Cleanup complete | session={self.session.session_id}")
