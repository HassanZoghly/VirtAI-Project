from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass

from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger

from app.application.chat.session_manager import Session
from app.presentation.ws.connection_manager import WSConnectionManager
from app.presentation.ws.outbound_sender import OutboundSender
from app.presentation.ws.pipeline_bridge import PipelineBridge, _pipeline_task_done_callback
from app.presentation.ws.protocol_router import ProtocolRouter
from app.presentation.ws.session_bootstrap import SessionBootstrap
from app.presentation.ws.voice_mode_handler import VoiceModeHandler
from app.schemas.ws_messages import ServerMessage, ServerMessageType, make_error_msg
from app.shared.config import get_settings


@dataclass(frozen=True)
class PendingSession:
    session_id: str
    avatar_id: str

    def touch(self) -> None:
        pass


class WebSocketHandler:
    """
    Handles a single WebSocket connection.
    Composed of ProtocolRouter, SessionBootstrap, PipelineBridge, OutboundSender.
    """
    _family_id: str | None = None

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
        self._family_id = None
        self._avatar_id = avatar_id
        self._voice_id = self._normalize_voice(voice_id)
        self._session_pending = session is None
        self._requested_session_id = requested_session_id
        self.session = session or PendingSession(
            session_id=requested_session_id or "",
            avatar_id=avatar_id,
        )
        self.pipeline = session.pipeline if session is not None else None
        self.connection_manager = connection_manager
        self.resumed = resumed
        self.replay_after_seq = replay_after_seq

        # Connection state
        self._connected = True
        self._last_pong_time = time.time()

        # Background tasks
        self._heartbeat_task: asyncio.Task | None = None
        self._voice_mode_handler: VoiceModeHandler | None = None

        # Components
        self.outbound_sender = OutboundSender(self.ws, self.connection_manager)
        self.session_bootstrap = SessionBootstrap(self._session_manager, self.connection_manager)
        self.pipeline_bridge = PipelineBridge(self)
        self.protocol_router = ProtocolRouter(self)

        from app.shared.metrics import ws_connections_active

        ws_connections_active.inc()

        logger.info(
            f"WebSocketHandler created | "
            f"session={self.session.session_id or 'pending'} | "
            f"avatar={self.session.avatar_id} | "
            f"resumed={resumed} | replay_after_seq={replay_after_seq}"
        )

    async def _cleanup(self) -> None:
        self._connected = False
        if self._heartbeat_task and not self._heartbeat_task.done():
            self._heartbeat_task.cancel()

        await self.pipeline_bridge.cancel_pipeline()

        if self._voice_mode_handler:
            self._voice_mode_handler.audio_pipeline.clear_buffer()

        try:
            from starlette.websockets import WebSocketState

            if self.ws.client_state == WebSocketState.CONNECTED:
                await self.ws.send_text('{"type":"chat.abort","data":{}}')
        except Exception as e:
            logger.debug(f"[WS] Could not send abort frame during cleanup: {e}")

        from app.shared.metrics import ws_connections_active

        ws_connections_active.dec()

    def _normalize_voice(self, voice_id: str) -> str:
        if not voice_id:
            return "aria"
        return voice_id

    async def _ensure_session(self) -> None:
        if not self._session_pending:
            return
        self.session, self._session_pending = await self.session_bootstrap.ensure_session(
            self.ws,
            self._user_id,
            self._avatar_id,
            self._voice_id,
            self._requested_session_id,
            self._family_id,
            self._session_pending,
        )
        self.pipeline = self.session.pipeline

    async def run(self) -> None:
        settings = get_settings()
        replay_batch: list[str] = []
        if self.resumed and self.session.session_id:
            await self.connection_manager.register(
                self.session.session_id, self.ws, user_id=self._user_id, family_id=self._family_id
            )
            replay_batch = await self.connection_manager.get_replay_batch(
                self.session.session_id, after_seq=self.replay_after_seq
            )

        try:
            await self.outbound_sender.send(
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
                ),
                self.session.session_id,
                self._session_pending,
            )

            if self.resumed:
                for payload in replay_batch:
                    if not self._connected:
                        break
                    try:
                        await self.ws.send_text(payload)
                    except Exception:
                        break
        except Exception as e:
            logger.error(f"[WS] Failed to send ready message: {e}")
            self._connected = False
            try:
                await self.ws.close(code=1011, reason="Internal server error")
            except Exception:
                pass
            return

        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        try:
            while self._connected:
                try:
                    message = await asyncio.wait_for(self.ws.receive(), timeout=1.0)

                    if message.get("type") == "websocket.disconnect":
                        self._connected = False
                        break

                    max_size = settings.WS_MAX_MESSAGE_SIZE
                    if "text" in message:
                        msg_size = len(message["text"].encode("utf-8"))
                        if msg_size > max_size:
                            await self._close_for_message_too_large(msg_size, max_size, "text")
                            break
                    elif "bytes" in message:
                        msg_size = len(message["bytes"])
                        if msg_size > max_size:
                            await self._close_for_message_too_large(msg_size, max_size, "binary")
                            break

                    if "text" in message:
                        await self.protocol_router.route_message(message["text"])
                    elif "bytes" in message:
                        await self._handle_binary_frame(message["bytes"])

                except asyncio.TimeoutError:
                    continue
                except WebSocketDisconnect:
                    from app.shared.metrics import ws_connection_drops

                    ws_connection_drops.labels(reason="client_disconnect").inc()
                    self._connected = False
                    break
                except RuntimeError as e:
                    from app.shared.metrics import ws_connection_drops

                    if "disconnect" in str(e).lower() or "receive" in str(e).lower():
                        ws_connection_drops.labels(reason="runtime_error_disconnect").inc()
                    else:
                        logger.error(f"[WS] Unexpected RuntimeError: {e}")
                        ws_connection_drops.labels(reason="runtime_error").inc()
                    self._connected = False
                    break
                except Exception as e:
                    logger.error(f"[WS] Error receiving message: {e}")
                    from app.shared.metrics import ws_connection_drops

                    ws_connection_drops.labels(reason="unexpected_error").inc()
                    await self.outbound_sender.safe_send(
                        make_error_msg(code="INTERNAL_ERROR", message="Error processing message"),
                        self.session.session_id,
                        self._session_pending,
                        self._connected,
                    )
        finally:
            await self._cleanup()

    async def _heartbeat_loop(self) -> None:
        self._last_pong_time = time.time()
        settings = get_settings()
        while self._connected:
            await asyncio.sleep(settings.WS_HEARTBEAT_INTERVAL)
            if not self._connected:
                break

            if time.time() - self._last_pong_time > settings.WS_HEARTBEAT_TIMEOUT:
                self._connected = False
                break

            try:
                await self.outbound_sender.send(
                    ServerMessage(type=ServerMessageType.PONG, data={"timestamp": time.time()}),
                    self.session.session_id,
                    self._session_pending,
                )
            except Exception:
                self._connected = False
                break

    async def _get_voice_mode_handler(self) -> VoiceModeHandler:
        await self._ensure_session()
        if self._voice_mode_handler is None:
            pipeline = self.pipeline
            if not pipeline:
                raise RuntimeError("Pipeline not initialized")
            asr_service = pipeline._asr
            if asr_service is None:
                raise ValueError("ASR service not injected into pipeline")

            self._voice_mode_handler = VoiceModeHandler(
                websocket=self.ws,
                session_id=self.session.session_id,
                asr_service=asr_service,
                turn_callback=self._run_text_turn,
                outbound_sender=self.outbound_sender,
            )
        return self._voice_mode_handler

    async def _run_text_turn(self, text: str) -> None:
        if not text or not text.strip():
            return

        await self._ensure_session()
        await self.pipeline_bridge.cancel_pipeline()
        pipeline = self.pipeline
        if not pipeline:
            raise RuntimeError("Pipeline not initialized")

        message_id = str(uuid.uuid4())
        session_id = self.session.session_id
        trace_id = str(uuid.uuid4())

        async def send_callback(message):
            await self.outbound_sender.send_protocol_message(
                message, session_id, self._session_pending, self._connected
            )

        async def send_binary_callback(data: bytes):
            if self._connected:
                await self.outbound_sender.send_binary(data)

        self.pipeline_bridge.pipeline_task = asyncio.create_task(
            pipeline.process_message(
                message_id=message_id,
                text=text,
                session_id=session_id,
                send_callback=send_callback,
                send_binary_callback=send_binary_callback,
                trace_id=trace_id,
            ),
            name=f"pipeline_voice_{session_id}",
        )
        self.pipeline_bridge.pipeline_task.add_done_callback(_pipeline_task_done_callback)

    async def _handle_binary_frame(self, pcm_bytes: bytes) -> None:
        try:
            self.session.touch()
            self._last_pong_time = time.time()

            voice_handler = await self._get_voice_mode_handler()

            is_final = False
            if len(pcm_bytes) >= 3:
                marker = pcm_bytes[-1]
                pcm_data = pcm_bytes[:-1]
                if len(pcm_data) % 2 == 0 and marker in (0x00, 0x01):
                    is_final = marker == 0x01
                else:
                    pcm_data = pcm_bytes
            else:
                pcm_data = pcm_bytes

            await voice_handler.handle_audio_chunk(pcm_data, is_final=is_final)

        except Exception as e:
            logger.error(f"[WS] Error handling binary frame: {e}")
            await self.outbound_sender.safe_send(
                make_error_msg(code="BINARY_FRAME_ERROR", message="Error processing audio data"),
                self.session.session_id,
                self._session_pending,
                self._connected,
            )

    async def _close_for_message_too_large(self, size: int, max_size: int, frame_type: str) -> None:
        await self.outbound_sender.safe_send(
            make_error_msg(
                code="MESSAGE_TOO_LARGE",
                message=f"WebSocket frame exceeds max size ({max_size} bytes)",
            ),
            self.session.session_id,
            self._session_pending,
            self._connected,
        )
        try:
            await self.ws.close(code=1009)
        except Exception:
            pass
        self._connected = False
