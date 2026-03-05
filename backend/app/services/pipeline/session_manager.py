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

from app.services.pipeline.conversation import ConversationPipeline

if TYPE_CHECKING:
    from app.services.llm.groq_provider import GroqLLMProvider
    from app.services.tts.edge_tts_provider import EdgeTTSProvider


class ConversationSession:
    """
    Represents a single active WebSocket session.

    Renamed from Session to ConversationSession for clarity and to match design document.
    Tracks session lifecycle with last_activity timestamp for cleanup.
    """

    def __init__(
        self,
        session_id: str,
        avatar_id: str = "avatar1",
        llm_service: Optional[GroqLLMProvider] = None,
        tts_service: Optional[EdgeTTSProvider] = None,
    ):
        """
        Initialize conversation session.

        Args:
            session_id: Unique session identifier
            avatar_id: Avatar identifier for this session
            llm_service: Optional LLM service instance (creates default if None)
            tts_service: Optional TTS service instance (creates default if None)
        """
        self.session_id: str = session_id
        self.avatar_id: str = avatar_id
        self.pipeline: ConversationPipeline = ConversationPipeline(
            avatar_id=avatar_id,
            llm=llm_service,
            tts=tts_service,
        )
        self.created_at: datetime = datetime.now(timezone.utc)
        self.last_activity: datetime = datetime.now(timezone.utc)  # Renamed from last_active
        self.background_tasks: set[asyncio.Task] = set()
        self.on_cleanup: Optional[Callable[[], None]] = None

    def touch(self) -> None:
        """Updates last_activity timestamp."""
        self.last_activity = datetime.now(timezone.utc)

    @property
    def idle_seconds(self) -> float:
        """Calculate seconds since last activity."""
        delta = datetime.now(timezone.utc) - self.last_activity
        return delta.total_seconds()

    def cleanup(self) -> None:
        """Cancels background tasks and calls cleanup callback."""
        # Cancel all pending background tasks
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

    Refactored to remove singleton pattern - instances are created via dependency injection.
    Implements session lifecycle management with configurable timeout and cleanup.

    Preconditions:
    - session_timeout_sec must be positive integer

    Postconditions:
    - Sessions are tracked with last_activity timestamps
    - Idle sessions are cleaned up periodically
    - All async tasks are properly cancelled on cleanup
    """

    def __init__(
        self,
        session_timeout_sec: int = 300,
        session_cleanup_interval: int = 60,
        llm_service_factory: Optional[Callable[[], GroqLLMProvider]] = None,
        tts_service_factory: Optional[Callable[[], EdgeTTSProvider]] = None,
    ):
        """
        Initialize SessionManager with configurable timeout.

        Args:
            session_timeout_sec: Seconds of inactivity before session is considered idle (default: 300)
            session_cleanup_interval: Seconds between cleanup runs (default: 60)
            llm_service_factory: Optional factory function to create LLM service instances
            tts_service_factory: Optional factory function to create TTS service instances

        Preconditions:
        - session_timeout_sec > 0
        - session_cleanup_interval > 0

        Postconditions:
        - Manager is ready to create and track sessions
        - No cleanup task is running (must be started separately)
        """
        if session_timeout_sec <= 0:
            raise ValueError("session_timeout_sec must be positive")
        if session_cleanup_interval <= 0:
            raise ValueError("session_cleanup_interval must be positive")

        self._sessions: dict[str, ConversationSession] = {}
        self._timeout = session_timeout_sec
        self._cleanup_interval = session_cleanup_interval
        self._cleanup_task: Optional[asyncio.Task] = None
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
        session_id: str | None = None,
        avatar_id: str = "avatar1",
        on_cleanup: Optional[Callable[[], None]] = None,
        llm_service: Optional[GroqLLMProvider] = None,
        tts_service: Optional[EdgeTTSProvider] = None,
    ) -> ConversationSession:
        """
        Create a new session and register it.

        Args:
            session_id: Optional session ID (generates UUID if not provided)
            avatar_id: Avatar identifier for this session
            on_cleanup: Optional callback to invoke on session cleanup
            llm_service: Optional LLM service instance (uses factory if None)
            tts_service: Optional TTS service instance (uses factory if None)

        Returns:
            ConversationSession: Newly created session

        Preconditions:
        - avatar_id is valid string

        Postconditions:
        - Session is created and tracked in _sessions
        - Session has initialized pipeline and timestamps
        - Returns session with unique ID
        """
        sid = session_id or str(uuid.uuid4())

        # Use provided services or create from factories
        llm = llm_service or (self._llm_service_factory() if self._llm_service_factory else None)
        tts = tts_service or (self._tts_service_factory() if self._tts_service_factory else None)

        session = ConversationSession(
            session_id=sid,
            avatar_id=avatar_id,
            llm_service=llm,
            tts_service=tts,
        )
        session.on_cleanup = on_cleanup
        self._sessions[sid] = session

        logger.info(
            f"Session created | "
            f"id={sid} | "
            f"avatar={avatar_id} | "
            f"total_active={len(self._sessions)}"
        )
        return session

    async def get_session(self, session_id: str) -> ConversationSession | None:
        """
        Retrieve existing session by ID.

        Args:
            session_id: Session identifier to retrieve

        Returns:
            ConversationSession if found, None otherwise

        Postconditions:
        - If session exists, last_activity is updated
        - Returns None if session not found
        """
        session = self._sessions.get(session_id)
        if session:
            session.touch()
        return session

    def remove_session(self, session_id: str) -> None:
        """
        Remove a session (called on WebSocket disconnect).

        Args:
            session_id: Session identifier to remove

        Postconditions:
        - Session is cleaned up (tasks cancelled, callback invoked)
        - Session is removed from tracking dictionary
        - No-op if session doesn't exist
        """
        if session_id in self._sessions:
            session = self._sessions[session_id]
            session.cleanup()
            del self._sessions[session_id]
            logger.info(
                f"Session removed | " f"id={session_id} | " f"total_active={len(self._sessions)}"
            )

    async def cleanup_idle(self) -> int:
        """
        Remove sessions that have been idle beyond timeout.

        Called periodically by background task to clean up inactive sessions.

        Returns:
            int: Number of sessions removed

        Preconditions:
        - session_timeout_sec is positive integer
        - _sessions dict is initialized

        Postconditions:
        - All idle sessions are removed
        - Active sessions are not affected
        - Returns count >= 0

        Loop Invariants:
        - All checked sessions have valid last_activity timestamp
        - Removed sessions are properly cleaned up
        """
        idle_ids = [
            sid for sid, session in self._sessions.items() if session.idle_seconds > self._timeout
        ]
        for sid in idle_ids:
            self.remove_session(sid)
        if idle_ids:
            logger.info(f"Cleaned up {len(idle_ids)} idle sessions")
        return len(idle_ids)

    async def abort_session(self, session_id: str, message_id: str) -> None:
        """
        Cancel current generation and TTS jobs for a session.

        Args:
            session_id: Session identifier
            message_id: Message identifier to abort

        Postconditions:
        - Current pipeline generation is cancelled
        - Session returns to idle state
        - No-op if session doesn't exist
        """
        session = self._sessions.get(session_id)
        if session:
            # Abort the pipeline
            session.pipeline.abort()
            logger.info(
                f"Session aborted | " f"session_id={session_id} | " f"message_id={message_id}"
            )

    async def _cleanup_loop(self, interval: int = 60) -> None:
        """
        Background task that periodically cleans up idle sessions.

        Args:
            interval: Seconds between cleanup runs (default: 60)

        Loop Invariants:
        - Runs every interval seconds
        - Continues until cancelled
        """
        try:
            while True:
                await asyncio.sleep(interval)
                await self.cleanup_idle()
        except asyncio.CancelledError:
            logger.info("Cleanup loop stopped")
            raise

    def start_cleanup_task(self, interval: int | None = None) -> None:
        """
        Start the background cleanup loop.

        Args:
            interval: Seconds between cleanup runs (uses configured interval if None)

        Postconditions:
        - Cleanup task is running in background
        - No-op if task already running
        """
        if self._cleanup_task is None:
            cleanup_interval = interval if interval is not None else self._cleanup_interval
            self._cleanup_task = asyncio.create_task(self._cleanup_loop(cleanup_interval))
            logger.info(f"Cleanup task started | interval={cleanup_interval}s")

    async def stop_cleanup_task(self) -> None:
        """
        Stop the background cleanup loop.

        Postconditions:
        - Cleanup task is cancelled and awaited
        - _cleanup_task is set to None
        - No-op if task not running
        """
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
        """Return count of active sessions."""
        return len(self._sessions)

    def get_stats(self) -> dict:
        """
        Get statistics about active sessions.

        Returns:
            dict: Statistics including active count and session details
        """
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
