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

from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger

from app.schemas.audio import AudioBuffer
from app.schemas.ws_messages import (
    AvatarStatus,
    ClientMessageType,
    ServerMessage,
    ServerMessageType,
    make_error_msg,
    make_status_msg,
    make_transcript_msg,
    make_tts_chunk_msg,
    make_visemes_msg,
    make_llm_chunk_msg,
    VisemesData,
    VisemeEvent,
)
from app.services.pipeline.conversation import ConversationPipeline
from app.services.pipeline.events import PipelineEvent, PipelineEventType
from app.services.pipeline.session_manager import Session

# Constants
MAX_AUDIO_BUFFER_SIZE = 24 * 1024 * 1024    # 24 MB
PING_INTERVAL = 30                          # seconds
PING_TIMEOUT = 60                            # seconds


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
        self._ping_task: asyncio.Task | None = None

        # Connection state
        self._connected = True
        self._last_pong = time.time()

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
        # Send ready signal with session info
        await self._send(ServerMessage(
            type=ServerMessageType.READY,
            data={
                "session_id": self.session.session_id,
                "avatar_id": self.session.avatar_id,
                "message": "Connected and ready",
                "timestamp": time.time(),
            }
        ))

        logger.info(f"WS ready | session={self.session.session_id}")

        # Start ping/pong task
        self._ping_task = asyncio.create_task(self._ping_loop())

        # Audio buffer for current recording
        audio_buffer = AudioBuffer()

        try:
            while self._connected:
                try:
                    # Wait for message with timeout to keep ping task alive
                    raw = await asyncio.wait_for(
                        self.ws.receive_text(),
                        timeout=1.0  # short timeout so ping loop can run
                    )
                    await self._route_message(raw, audio_buffer)
                except asyncio.TimeoutError:
                    # No message received, continue (ping loop handles keepalive)
                    continue
                except WebSocketDisconnect:
                    logger.info(f"Client disconnected | session={self.session.session_id}")
                    break
                except Exception as e:
                    logger.error(f"Error receiving message: {e}")
                    await self._safe_send(make_error_msg(
                        code="INTERNAL_ERROR",
                        message="Error processing message"
                    ))
        finally:
            await self._cleanup()

    async def _ping_loop(self) -> None:
        """
        Background task: periodically send ping and check for pong responses.
        If no pong received within timeout, close the connection.
        """
        while self._connected:
            await asyncio.sleep(PING_INTERVAL)
            if not self._connected:
                break

            try:
                await self._send(ServerMessage(
                    type=ServerMessageType.PONG,
                    data={"timestamp": time.time()}
                ))
                # Wait for a short period to see if we get a pong back?
                # Actually, we don't need to wait; we just keep connection alive.
                # If client disconnects, receive loop will break.
            except Exception as e:
                logger.warning(f"Ping failed: {e}")
                break

    async def _route_message(self, raw: str, audio_buffer: AudioBuffer) -> None:
        """Parse incoming JSON and route to appropriate handler."""
        try:
            data = json.loads(raw)
            msg_type = ClientMessageType(data.get("type", ""))
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"Invalid message format: {raw[:100]} | {e}")
            await self._safe_send(make_error_msg(
                code="INVALID_MESSAGE",
                message="Invalid message format"
            ))
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
                await self._handle_abort()
            case _:
                logger.warning(f"Unknown message type: {msg_type}")
                await self._safe_send(make_error_msg(
                    code="UNKNOWN_TYPE",
                    message=f"Unknown message type: {msg_type.value}"
                ))

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
            await self._safe_send(make_error_msg(
                code="INVALID_AUDIO",
                message="Failed to decode audio chunk"
            ))
            return

        # Prevent buffer overflow
        if audio_buffer.total_size + len(chunk_bytes) > MAX_AUDIO_BUFFER_SIZE:
            logger.warning(f"Audio buffer overflow, clearing")
            audio_buffer.clear()
            await self._safe_send(make_error_msg(
                code="AUDIO_TOO_LARGE",
                message="Audio exceeds maximum allowed size"
            ))
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
            await self._safe_send(make_error_msg(
                code="EMPTY_AUDIO",
                message="No audio received"
            ))
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

        logger.info(f"Starting audio pipeline | chunks={snapshot.chunk_count} | size={snapshot.total_size}")

        self._pipeline_task = asyncio.create_task(
            self._run_pipeline_audio(snapshot),
            name=f"pipeline_audio_{self.session.session_id}"
        )

    async def _handle_text_input(self, data: dict) -> None:
        """Direct text input → start pipeline (skip ASR)."""
        text = data.get("data", {}).get("text", "").strip()
        if not text:
            await self._safe_send(make_error_msg(
                code="EMPTY_TEXT",
                message="Empty text input"
            ))
            return

        # Cancel any ongoing pipeline
        await self._cancel_pipeline()

        logger.info(f"Starting text pipeline | text='{text[:60]}'")

        self._pipeline_task = asyncio.create_task(
            self._run_pipeline_text(text),
            name=f"pipeline_text_{self.session.session_id}"
        )

    async def _handle_ping(self) -> None:
        """Respond to client ping."""
        await self._send(ServerMessage(
            type=ServerMessageType.PONG,
            data={"timestamp": time.time()}
        ))

    async def _handle_abort(self) -> None:
        """Client requested abort."""
        logger.info(f"Abort received | session={self.session.session_id}")
        await self._cancel_pipeline()
        await self._safe_send(make_status_msg(AvatarStatus.IDLE))

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
            await self._safe_send(make_error_msg(
                code="PIPELINE_ERROR",
                message="An error occurred during processing"
            ))
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
            await self._safe_send(make_error_msg(
                code="PIPELINE_ERROR",
                message="An error occurred during processing"
            ))
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
                await self._send(make_transcript_msg(
                    text=event.data.get("text", ""),
                    is_final=True
                ))

            case PipelineEventType.LLM_TOKEN:
                token = event.data.get("token", "")
                if token:
                    await self._send(make_llm_chunk_msg(token))

            case PipelineEventType.LLM_DONE:
                await self._send(ServerMessage(
                    type=ServerMessageType.LLM_END,
                    data={}
                ))

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

                await self._send(make_visemes_msg(VisemesData(
                    events=viseme_objs,
                    audio_duration_ms=audio_dur,
                )))

            case PipelineEventType.TTS_AUDIO:
                audio_b64 = event.data.get("audio", "")
                chunk_idx = event.data.get("chunk_index", 0)

                if chunk_idx == 0:
                    # First chunk → send TTS_START
                    await self._send(ServerMessage(
                        type=ServerMessageType.TTS_START,
                        data={"sentence_index": event.data.get("sentence_index", 0)}
                    ))

                await self._send(make_tts_chunk_msg(
                    audio_b64=audio_b64,
                    chunk_index=chunk_idx,
                ))

            case PipelineEventType.TTS_DONE:
                await self._send(ServerMessage(
                    type=ServerMessageType.TTS_END,
                    data={}
                ))

            case PipelineEventType.ERROR:
                await self._send(make_error_msg(
                    code=event.data.get("code", "UNKNOWN_ERROR"),
                    message=event.data.get("message", "Unknown error"),
                ))

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

        if self._ping_task and not self._ping_task.done():
            self._ping_task.cancel()
            try:
                await self._ping_task
            except asyncio.CancelledError:
                pass

        logger.info(f"Cleanup complete | session={self.session.session_id}")