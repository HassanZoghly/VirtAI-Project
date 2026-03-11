"""
Session management use case — lifecycle management for conversation sessions.

Extracted from services/pipeline/session_manager.py.
Dependencies are injected via factories or directly as domain ports.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from loguru import logger

from app.application.voice.handle_voice_turn import ConversationPipeline
from app.domain.chat.ports import BaseLLMProvider
from app.domain.voice.ports import BaseTTSProvider, StreamingASRService


class ConversationSession:
    """Represents a single active WebSocket session with isolated state."""

    def __init__(
        self,
        session_id: str,
        pipeline: ConversationPipeline,
        avatar_id: str = "avatar1",
    ) -> None:
        self.session_id = session_id
        self.avatar_id = avatar_id
        self.pipeline = pipeline
        self.created_at = datetime.now(timezone.utc)
        self.last_activity = datetime.now(timezone.utc)
        self.background_tasks: set[asyncio.Task] = set()
        self.on_cleanup: Optional[Callable[[], None]] = None

    def touch(self) -> None:
        self.last_activity = datetime.now(timezone.utc)

    @property
    def idle_seconds(self) -> float:
        return (datetime.now(timezone.utc) - self.last_activity).total_seconds()

    def cleanup(self) -> None:
        for task in self.background_tasks:
            if not task.done():
                task.cancel()
        if self.on_cleanup:
            self.on_cleanup()


# Backward-compat alias
Session = ConversationSession


class SessionManager:
    """
    Manages conversation sessions with lifecycle tracking and periodic cleanup.

    All adapter creation is delegated to injected factory callables so this
    class depends only on domain port types, never on concrete infrastructure.
    """

    def __init__(
        self,
        session_timeout_sec: int = 300,
        session_cleanup_interval: int = 60,
        asr_factory: Optional[Callable[[], StreamingASRService]] = None,
        llm_factory: Optional[Callable[[], BaseLLMProvider]] = None,
        tts_factory: Optional[Callable[[], BaseTTSProvider]] = None,
    ) -> None:
        self._sessions: dict[str, ConversationSession] = {}
        self._timeout = session_timeout_sec
        self._cleanup_interval = session_cleanup_interval
        self._cleanup_task: Optional[asyncio.Task] = None
        self._asr_factory = asr_factory
        self._llm_factory = llm_factory
        self._tts_factory = tts_factory

    async def create_session(
        self,
        session_id: str | None = None,
        avatar_id: str = "avatar1",
        voice_id: str | None = None,
        on_cleanup: Optional[Callable[[], None]] = None,
        asr: Optional[StreamingASRService] = None,
        llm: Optional[BaseLLMProvider] = None,
        tts: Optional[BaseTTSProvider] = None,
    ) -> ConversationSession:
        sid = session_id or str(uuid.uuid4())
        asr_svc = asr or (self._asr_factory() if self._asr_factory else None)
        llm_svc = llm or (self._llm_factory() if self._llm_factory else None)
        tts_svc = tts or (self._tts_factory() if self._tts_factory else None)

        if asr_svc is None or llm_svc is None or tts_svc is None:
            raise ValueError(
                "ASR, LLM, and TTS services must be provided either directly "
                "or via factory callables."
            )

        pipeline = ConversationPipeline(
            asr=asr_svc,
            llm=llm_svc,
            tts=tts_svc,
            avatar_id=avatar_id,
        )
        session = ConversationSession(session_id=sid, pipeline=pipeline, avatar_id=avatar_id)
        session.on_cleanup = on_cleanup

        if voice_id:
            session.pipeline._tts.voice = voice_id  # type: ignore[attr-defined]

        self._sessions[sid] = session
        logger.info(f"Session created | id={sid} | active={len(self._sessions)}")
        return session

    async def get_session(self, session_id: str) -> ConversationSession | None:
        session = self._sessions.get(session_id)
        if session:
            session.touch()
        return session

    def remove_session(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session:
            session.cleanup()
            del self._sessions[session_id]
            logger.info(f"Session removed | id={session_id} | remaining={len(self._sessions)}")

    async def cleanup_idle(self) -> int:
        idle_ids = [sid for sid, s in self._sessions.items() if s.idle_seconds > self._timeout]
        for sid in idle_ids:
            self.remove_session(sid)
        if idle_ids:
            logger.info(f"Cleaned {len(idle_ids)} idle sessions")
        return len(idle_ids)

    async def abort_session(self, session_id: str, message_id: str) -> None:
        session = self._sessions.get(session_id)
        if session:
            session.pipeline.abort()
            logger.info(f"Session aborted | id={session_id} | msg={message_id}")

    @property
    def active_count(self) -> int:
        return len(self._sessions)

    def get_stats(self) -> dict:
        return {
            "active_sessions": len(self._sessions),
            "sessions": [
                {
                    "id": sid,
                    "avatar": s.avatar_id,
                    "idle_sec": round(s.idle_seconds, 1),
                    "history_length": s.pipeline.history_length,
                }
                for sid, s in self._sessions.items()
            ],
        }

    # ── Background cleanup ────────────────────────────────────────────────────

    def start_cleanup_task(self, interval: int | None = None) -> None:
        if self._cleanup_task is not None:
            return
        _interval = interval or self._cleanup_interval
        self._cleanup_task = asyncio.create_task(self._cleanup_loop(_interval))
        logger.info(f"Cleanup task started | interval={_interval}s")

    async def stop_cleanup_task(self) -> None:
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None
            logger.info("Cleanup task stopped")

    async def _cleanup_loop(self, interval: int = 60) -> None:
        try:
            while True:
                await asyncio.sleep(interval)
                await self.cleanup_idle()
        except asyncio.CancelledError:
            logger.info("Cleanup loop stopped")
            raise
