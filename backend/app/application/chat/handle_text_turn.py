"""
Text turn use case — handles text input through LLM → TTS pipeline (skips ASR).

Delegates to ConversationPipeline.process_text() and process_message().
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Optional

from app.application.voice.handle_voice_turn import ConversationPipeline
from app.domain.chat.entities import PipelineEvent


async def handle_text_turn(
    pipeline: ConversationPipeline,
    text: str,
    session_id: Optional[str] = None,
) -> AsyncGenerator[PipelineEvent, None]:
    """
    Process direct text input through LLM → TTS (no ASR).

    Args:
        pipeline: Active ConversationPipeline for this session.
        text: User's text message.
        session_id: Optional session identifier for tracking.

    Yields:
        PipelineEvent objects (THINKING, LLM_TOKEN, TTS_AUDIO, etc.)
    """
    async for event in pipeline.process_text(text, session_id=session_id):
        yield event


async def handle_message(
    pipeline: ConversationPipeline,
    message_id: str,
    text: str,
    session_id: str,
    send_callback: callable,
) -> None:
    """
    Process user message through LLM → TTS → Visemes with callback-based delivery.

    Args:
        pipeline: Active ConversationPipeline for this session.
        message_id: Unique message identifier.
        text: User's text message.
        session_id: Session identifier.
        send_callback: Async callback to send messages to client.
    """
    await pipeline.process_message(
        message_id=message_id,
        text=text,
        session_id=session_id,
        send_callback=send_callback,
    )
