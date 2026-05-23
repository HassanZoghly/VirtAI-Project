import asyncio
import uuid
from loguru import logger
from app.domain.chat.entities import PipelineEvent, PipelineEventType
from app.schemas.audio import AudioBuffer
from app.schemas.ws_messages import (
    AvatarStatus, ServerMessage, ServerMessageType, VisemeEvent, VisemesData,
    make_status_msg, make_transcript_msg, make_llm_chunk_msg, make_visemes_msg,
    make_tts_chunk_msg, make_error_msg
)
from app.presentation.ws.outbound_sender import OutboundSender

class PipelineBridge:
    """Bridges the WebSocket connection with the ConversationPipeline."""

    def __init__(self, context):
        """
        context must provide:
        - session, _session_pending, _connected
        - pipeline
        - _safe_send, _send (from OutboundSender)
        - _send_protocol_message (from OutboundSender)
        """
        self.ctx = context
        self.pipeline_task: asyncio.Task | None = None

    async def cancel_pipeline(self) -> None:
        """Cancel any running pipeline task and wait for it to stop."""
        if self.pipeline_task and not self.pipeline_task.done():
            if self.ctx.pipeline is not None:
                self.ctx.pipeline.abort()
            self.pipeline_task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(self.pipeline_task), timeout=2.0)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                pass
            logger.debug("Pipeline task cancelled")
        self.pipeline_task = None



    async def forward_pipeline_event(self, event: PipelineEvent) -> None:
        """Convert PipelineEvent to WebSocket message and send."""
        sid = self.ctx.session.session_id
        pending = self.ctx._session_pending
        
        match event.type:
            case PipelineEventType.PROCESSING:
                await self.ctx.outbound_sender.send(make_status_msg(AvatarStatus.PROCESSING), sid, pending)
            case PipelineEventType.THINKING:
                await self.ctx.outbound_sender.send(make_status_msg(AvatarStatus.THINKING), sid, pending)
            case PipelineEventType.SPEAKING:
                await self.ctx.outbound_sender.send(make_status_msg(AvatarStatus.SPEAKING), sid, pending)
            case PipelineEventType.IDLE | PipelineEventType.ABORT:
                await self.ctx.outbound_sender.send(make_status_msg(AvatarStatus.IDLE), sid, pending)

            case PipelineEventType.TRANSCRIPT:
                await self.ctx.outbound_sender.send(
                    make_transcript_msg(text=event.data.get("text", ""), is_final=True), sid, pending
                )

            case PipelineEventType.LLM_TOKEN:
                token = event.data.get("token", "")
                if token:
                    await self.ctx.outbound_sender.send(make_llm_chunk_msg(token), sid, pending)

            case PipelineEventType.LLM_DONE:
                await self.ctx.outbound_sender.send(ServerMessage(type=ServerMessageType.LLM_END, data={}), sid, pending)

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

                await self.ctx.outbound_sender.send(
                    make_visemes_msg(
                        VisemesData(
                            events=viseme_objs,
                            audio_duration_ms=audio_dur,
                        )
                    ), sid, pending
                )

            case PipelineEventType.TTS_AUDIO:
                audio_b64 = event.data.get("audio", "")
                chunk_idx = event.data.get("chunk_index", 0)

                if chunk_idx == 0:
                    await self.ctx.outbound_sender.send(
                        ServerMessage(
                            type=ServerMessageType.TTS_START,
                            data={"sentence_index": event.data.get("sentence_index", 0)},
                        ), sid, pending
                    )

                await self.ctx.outbound_sender.send(
                    make_tts_chunk_msg(
                        audio_b64=audio_b64,
                        chunk_index=chunk_idx,
                    ), sid, pending
                )

            case PipelineEventType.TTS_DONE:
                await self.ctx.outbound_sender.send(ServerMessage(type=ServerMessageType.TTS_END, data={}), sid, pending)

            case PipelineEventType.ERROR:
                await self.ctx.outbound_sender.send(
                    make_error_msg(
                        code=event.data.get("code", "UNKNOWN_ERROR"),
                        message=event.data.get("message", "Unknown error"),
                    ), sid, pending
                )

            case _:
                logger.debug(f"Unhandled pipeline event: {event.type}")
