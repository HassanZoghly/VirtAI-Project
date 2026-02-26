"""
Manages active WebSocket sessions.
Each session has its own ConversationPipeline.

Why a SessionManager?
→ Multiple users can connect simultaneously
→ Each needs isolated history and state
→ We need to clean up when connections drop
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Callable, Optional

from loguru import logger

from app.services.pipeline.conversation import ConversationPipeline


class Session:
    """Represents a single active WebSocket session."""
    def __init__(self, session_id: str, avatar_id: str = "avatar1"):
        self.session_id: str = session_id
        self.avatar_id: str = avatar_id
        self.pipeline: ConversationPipeline = ConversationPipeline(avatar_id)
        self.created_at: datetime = datetime.now(timezone.utc)
        self.last_active: datetime = datetime.now(timezone.utc)
        self.background_tasks: set[asyncio.Task] = set()
        self.on_cleanup: Optional[Callable[[], None]] = None

    def touch(self) -> None:
        """Updates last_active timestamp."""
        self.last_active = datetime.now(timezone.utc)

    @property
    def idle_seconds(self) -> float:
        delta = datetime.now(timezone.utc) - self.last_active
        return delta.total_seconds()

    def cleanup(self) -> None:
        """Cancels background tasks and calls cleanup callback."""
        # Cancel all pending background tasks
        for task in self.background_tasks:
            task.cancel()
        self.background_tasks.clear()

        if self.on_cleanup:
            self.on_cleanup()


class SessionManager:
    """
    Singleton-like manager for all active sessions.
    Instantiated once in main.py and injected via dependency.
    """
    def __init__(self, session_timeout_sec: int = 300):
        self._sessions: dict[str, Session] = {}
        self._timeout = session_timeout_sec
        self._cleanup_task: Optional[asyncio.Task] = None
        logger.info(
            f"SessionManager initialized | "
            f"timeout={session_timeout_sec}s"
        )

    # ── Session Lifecycle ─────────────────────────────────────────────────────
    def create_session(
        self,
        avatar_id: str = "avatar1",
        session_id: str | None = None,
        on_cleanup: Optional[Callable[[], None]] = None,
    ) -> Session:
        """Creates a new session and registers it."""
        sid = session_id or str(uuid.uuid4())
        session = Session(session_id=sid, avatar_id=avatar_id)
        session.on_cleanup = on_cleanup
        self._sessions[sid] = session

        logger.info(
            f"Session created | "
            f"id={sid} | "
            f"avatar={avatar_id} | "
            f"total_active={len(self._sessions)}"
        )
        return session

    def get_session(self, session_id: str) -> Session | None:
        """Returns session by ID, or None if not found."""
        session = self._sessions.get(session_id)
        if session:
            session.touch()
        return session

    def remove_session(self, session_id: str) -> None:
        """Removes a session (called on WebSocket disconnect)."""
        if session_id in self._sessions:
            session = self._sessions[session_id]
            session.cleanup()
            del self._sessions[session_id]
            logger.info(
                f"Session removed | "
                f"id={session_id} | "
                f"total_active={len(self._sessions)}"
            )

    async def cleanup_idle(self) -> int:
        """
        Removes sessions that have been idle too long.
        Called periodically by a background task.
        Returns the number of sessions removed.
        """
        idle_ids = [
            sid
            for sid, session in self._sessions.items()
            if session.idle_seconds > self._timeout
        ]
        for sid in idle_ids:
            self.remove_session(sid)
        if idle_ids:
            logger.info(f"Cleaned up {len(idle_ids)} idle sessions")
        return len(idle_ids)

    async def _cleanup_loop(self, interval: int = 60) -> None:
        """Background task that periodically cleans up idle sessions."""
        try:
            while True:
                await asyncio.sleep(interval)
                await self.cleanup_idle()
        except asyncio.CancelledError:
            logger.info("Cleanup loop stopped")
            raise

    def start_cleanup_task(self, interval: int = 60) -> None:
        """Starts the background cleanup loop."""
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._cleanup_loop(interval))

    async def stop_cleanup_task(self) -> None:
        """Stops the background cleanup loop."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None

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
                    "avatar": s.avatar_id,
                    "idle_sec": round(s.idle_seconds, 1),
                    "history_length": s.pipeline.history_length,
                }
                for sid, s in self._sessions.items()
            ],
        }