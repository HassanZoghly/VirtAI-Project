"""
Manages active WebSocket sessions.
Each session has its own ConversationPipeline.

Why a SessionManager?
→ Multiple users can connect simultaneously
→ Each needs isolated history and state
→ We need to clean up when connections drop

Refactored to remove singleton pattern and use dependency injection.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

from loguru import logger

from app.application.voice.handle_voice_turn import ConversationPipeline
from app.infrastructure.db.chat_repository import create_chat_session

if TYPE_CHECKING:
    from app.domain.chat.ports import BaseLLMProvider
    from app.domain.voice.ports import BaseTTSProvider, StreamingASRService


class ConversationSession:
    """
    Represents a single active WebSocket session.

    Tracks session lifecycle with last_activity timestamp for cleanup.
    """

    def __init__(
        self,
        session_id: str,
        user_id: str,
        avatar_id: str = "avatar1",
        asr_service: Optional[StreamingASRService] = None,
        llm_service: Optional[BaseLLMProvider] = None,
        tts_service: Optional[BaseTTSProvider] = None,
    ):
        self.session_id: str = session_id
        self.user_id: str = user_id
        self.avatar_id: str = avatar_id
        self.pipeline: ConversationPipeline = ConversationPipeline(
            asr=asr_service,
            llm=llm_service,
            tts=tts_service,
            avatar_id=avatar_id,
        )
        self.created_at: datetime = datetime.now(timezone.utc)
        self.last_activity: datetime = datetime.now(timezone.utc)
        self.connected: bool = True
        self.disconnected_at: datetime | None = None
        self.background_tasks: set[asyncio.Task] = set()
        self.on_cleanup: Optional[Callable[[], None]] = None

    def touch(self) -> None:
        """Updates last_activity timestamp."""
        self.last_activity = datetime.now(timezone.utc)

    def mark_connected(self) -> None:
        self.connected = True
        self.disconnected_at = None
        self.touch()

    def mark_disconnected(self) -> None:
        self.connected = False
        self.disconnected_at = datetime.now(timezone.utc)
        self.touch()

    @property
    def idle_seconds(self) -> float:
        """Calculate seconds since last activity."""
        delta = datetime.now(timezone.utc) - self.last_activity
        return delta.total_seconds()

    def cleanup(self) -> None:
        """Cancels background tasks and calls cleanup callback."""
        for task in self.background_tasks:
            task.cancel()
        self.background_tasks.clear()

        if self.on_cleanup:
            self.on_cleanup()


# Maintain backward compatibility alias
Session = ConversationSession


class SessionManager:
    """
    Manages conversation sessions with lifecycle tracking.

    Instances are created via dependency injection.
    """

    def __init__(
        self,
        session_timeout_sec: int = 300,
        session_cleanup_interval: int = 60,
        asr_service_factory: Optional[Callable[[], StreamingASRService]] = None,
        llm_service_factory: Optional[Callable[[], BaseLLMProvider]] = None,
        tts_service_factory: Optional[Callable[[], BaseTTSProvider]] = None,
    ):
        if session_timeout_sec <= 0:
            raise ValueError("session_timeout_sec must be positive")
        if session_cleanup_interval <= 0:
            raise ValueError("session_cleanup_interval must be positive")

        self._sessions: dict[str, ConversationSession] = {}
        self._timeout = session_timeout_sec
        self._cleanup_interval = session_cleanup_interval
        self._cleanup_task: Optional[asyncio.Task] = None
        self._asr_service_factory = asr_service_factory
        self._llm_service_factory = llm_service_factory
        self._tts_service_factory = tts_service_factory

        logger.info(
            f"SessionManager initialized | "
            f"timeout={session_timeout_sec}s | "
            f"cleanup_interval={session_cleanup_interval}s"
        )

    # ── Session Lifecycle ─────────────────────────────────────────────────────

    async def create_session(
        self,
        user_id: str,
        session_id: str | None = None,
        avatar_id: str = "avatar1",
        voice_id: str | None = None,
        on_cleanup: Optional[Callable[[], None]] = None,
        asr_service: Optional[StreamingASRService] = None,
        llm_service: Optional[BaseLLMProvider] = None,
        tts_service: Optional[BaseTTSProvider] = None,
    ) -> ConversationSession:
        sid = session_id or str(uuid.uuid4())
        if sid in self._sessions:
            # Guard accidental session-id reuse for new chats.
            sid = str(uuid.uuid4())

        await create_chat_session(user_id=user_id, session_id=sid)

        asr = asr_service or (self._asr_service_factory() if self._asr_service_factory else None)
        llm = llm_service or (self._llm_service_factory() if self._llm_service_factory else None)
        tts = tts_service or (self._tts_service_factory() if self._tts_service_factory else None)

        session = ConversationSession(
            session_id=sid,
            user_id=user_id,
            avatar_id=avatar_id,
            asr_service=asr,
            llm_service=llm,
            tts_service=tts,
        )
        session.on_cleanup = on_cleanup
        self._sessions[sid] = session

        if voice_id and hasattr(session.pipeline._tts, "voice"):
            try:
                session.pipeline._tts.voice = voice_id  # type: ignore[union-attr]
                logger.info(f"Session TTS voice set | id={sid} | voice={voice_id}")
            except Exception as e:
                logger.warning(f"Failed to set TTS voice: {e}")

        logger.info(
            f"Session created | "
            f"id={sid} | "
            f"user={user_id} | "
            f"avatar={avatar_id} | "
            f"voice={voice_id or 'default'} | "
            f"total_active={len(self._sessions)}"
        )
        return session

    async def get_session(self, session_id: str) -> ConversationSession | None:
        session = self._sessions.get(session_id)
        if session:
            session.touch()
        return session

    async def connect_existing_session(self, session_id: str) -> ConversationSession | None:
        """Mark an existing session as connected (used for WS resume)."""
        session = self._sessions.get(session_id)
        if session:
            session.mark_connected()
        return session

    def disconnect_session(self, session_id: str) -> None:
        """Mark session disconnected but keep it alive for timeout-based resume."""
        session = self._sessions.get(session_id)
        if session is None:
            return
        session.pipeline.abort()
        session.mark_disconnected()
        logger.info(f"Session disconnected | id={session_id} | total_active={len(self._sessions)}")

    def remove_session(self, session_id: str) -> None:
        if session_id in self._sessions:
            session = self._sessions[session_id]
            session.cleanup()
            del self._sessions[session_id]

            # Keep Redis chat context until TTL expiry to support reconnect warm-up
            # and avoid losing cache immediately on normal WebSocket disconnect.
            logger.debug(
                f"[SessionManager] Preserving Redis context until TTL | session={session_id}"
            )

            logger.info(f"Session removed | id={session_id} | total_active={len(self._sessions)}")

    async def cleanup_idle(self) -> int:
        idle_ids = [
            sid for sid, session in self._sessions.items() if session.idle_seconds > self._timeout
        ]
        for sid in idle_ids:
            self.remove_session(sid)
        if idle_ids:
            logger.info(f"Cleaned up {len(idle_ids)} idle sessions")
        return len(idle_ids)

    async def abort_session(self, session_id: str, message_id: str) -> None:
        session = self._sessions.get(session_id)
        if session:
            session.pipeline.abort()
            logger.info(f"Session aborted | session_id={session_id} | message_id={message_id}")

    async def _cleanup_loop(self, interval: int = 60) -> None:
        try:
            while True:
                await asyncio.sleep(interval)
                await self.cleanup_idle()
        except asyncio.CancelledError:
            logger.info("Cleanup loop stopped")
            raise

    def start_cleanup_task(self, interval: int | None = None) -> None:
        if self._cleanup_task is None:
            cleanup_interval = interval if interval is not None else self._cleanup_interval
            self._cleanup_task = asyncio.create_task(self._cleanup_loop(cleanup_interval))
            logger.info(f"Cleanup task started | interval={cleanup_interval}s")

    async def stop_cleanup_task(self) -> None:
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None
            logger.info("Cleanup task stopped")

    # ── Stats ─────────────────────────────────────────────────────────────────

    @property
    def active_count(self) -> int:
        return len(self._sessions)

    def get_stats(self) -> dict:
        return {
            "active_sessions": self.active_count,
            "sessions": [
                {
                    "id": sid,
                    "user_id": s.user_id,
                    "avatar": s.avatar_id,
                    "connected": s.connected,
                    "idle_sec": round(s.idle_seconds, 1),
                    "history_length": s.pipeline.history_length,
                }
                for sid, s in self._sessions.items()
            ],
        }
