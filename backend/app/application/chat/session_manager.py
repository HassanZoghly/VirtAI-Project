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
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from loguru import logger

from app.application.voice.handle_voice_turn import ConversationPipeline
from app.shared.ids import parse_uuid

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.application.rag.retrieval_use_case import RetrievalUseCase
    from app.domain.chat.ports import BaseLLMProvider
    from app.domain.voice.ports import BaseTTSProvider, StreamingASRService


class ConversationSession:
    """
    Represents a single active WebSocket session.
    """

    def __init__(
        self,
        session_id: str,
        user_id: str,
        avatar_id: str = "avatar1",
        asr_service: StreamingASRService | None = None,
        llm_service: BaseLLMProvider | None = None,
        tts_service: BaseTTSProvider | None = None,
        retrieval_service: RetrievalUseCase | None = None,
    ):
        self.session_id: str = session_id
        self.user_id: str = user_id
        self.avatar_id: str = avatar_id
        self.pipeline: ConversationPipeline = ConversationPipeline(
            asr=asr_service,
            llm=llm_service,
            tts=tts_service,
            retrieval=retrieval_service,
            avatar_id=avatar_id,
        )
        self.created_at: datetime = datetime.now(timezone.utc)
        self.last_activity: datetime = datetime.now(timezone.utc)
        self.connected: bool = True
        self.disconnected_at: datetime | None = None
        self.background_tasks: set[asyncio.Task] = set()
        self.on_cleanup: Callable[[], None] | None = None

    def touch(self) -> None:
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
        return (datetime.now(timezone.utc) - self.last_activity).total_seconds()

    def cleanup(self) -> None:
        for task in self.background_tasks:
            task.cancel()
        self.background_tasks.clear()
        if self.on_cleanup:
            self.on_cleanup()


# Maintain backward compatibility
Session = ConversationSession


class SessionManager:
    """
    Manages conversation sessions with lifecycle tracking.
    Now accepts a factory that returns a fresh AsyncSession per call.
    """

    def __init__(
        self,
        chat_repository_factory: Callable[[], Awaitable[AsyncSession]],
        session_timeout_sec: int = 300,
        session_cleanup_interval: int = 60,
        asr_service_factory: Callable[[], StreamingASRService] | None = None,
        llm_service_factory: Callable[[], BaseLLMProvider] | None = None,
        tts_service_factory: Callable[[], BaseTTSProvider] | None = None,
        retrieval_service_factory: Callable[[], Awaitable[RetrievalUseCase]] | None = None,
    ):
        if session_timeout_sec <= 0:
            raise ValueError("session_timeout_sec must be positive")
        if session_cleanup_interval <= 0:
            raise ValueError("session_cleanup_interval must be positive")

        self._repo_factory = chat_repository_factory
        self._sessions: dict[str, ConversationSession] = {}
        self._timeout = session_timeout_sec
        self._cleanup_interval = session_cleanup_interval
        self._cleanup_task: asyncio.Task | None = None
        self._asr_service_factory = asr_service_factory
        self._llm_service_factory = llm_service_factory
        self._tts_service_factory = tts_service_factory
        self._retrieval_service_factory = retrieval_service_factory
        self._lock = asyncio.Lock()

        logger.info(
            f"SessionManager initialized | "
            f"timeout={session_timeout_sec}s | "
            f"cleanup_interval={session_cleanup_interval}s"
        )

    async def _get_repo(self):
        """Returns a ChatRepository with a fresh AsyncSession."""
        from app.infrastructure.db.repositories.chat_repository import ChatRepository

        db = await self._repo_factory()
        return ChatRepository(db)

    async def _commit_repo(self, repo) -> None:
        db = getattr(repo, "db", None)
        commit = getattr(db, "commit", None)
        if commit is not None:
            await commit()

    async def _close_repo(self, repo) -> None:
        db = getattr(repo, "db", None)
        close = getattr(db, "close", None)
        if close is not None:
            await close()

    async def create_session(
        self,
        user_id: str,
        session_id: str | None = None,
        avatar_id: str = "avatar1",
        voice_id: str | None = None,
        on_cleanup: Callable[[], None] | None = None,
        asr_service: StreamingASRService | None = None,
        llm_service: BaseLLMProvider | None = None,
        tts_service: BaseTTSProvider | None = None,
        retrieval_service: RetrievalUseCase | None = None,
    ) -> ConversationSession:
        parsed_user_id = parse_uuid(user_id)
        if parsed_user_id is None:
            raise ValueError("Invalid user_id")
        user_id = str(parsed_user_id)

        if session_id is not None:
            parsed_session_id = parse_uuid(session_id)
            if parsed_session_id is None:
                raise ValueError("Invalid session_id")
            session_id = str(parsed_session_id)

        # If session already exists in memory, reuse it
        if session_id and session_id in self._sessions:
            existing = self._sessions[session_id]
            if existing.user_id != user_id:
                raise PermissionError("Cannot attach to another user's session.")
            existing.mark_connected()
            if voice_id and hasattr(existing.pipeline._tts, "voice"):
                try:
                    existing.pipeline._tts.voice = voice_id  # type: ignore
                    logger.info(f"Session TTS voice updated | id={session_id} | voice={voice_id}")
                except Exception as e:
                    logger.warning(f"Failed to update TTS voice on reconnect: {e}")
            return existing

        sid = session_id or str(uuid.uuid4())
        if session_id is None and sid in self._sessions:
            sid = str(uuid.uuid4())

        # Check persistence using a fresh repository
        repo = await self._get_repo()
        try:
            persisted = await repo.get_chat_session(sid)
            if persisted is not None:
                if persisted.get("user_id") != user_id:
                    raise PermissionError("Cannot attach to another user's session.")
            else:
                await repo.create_chat_session(user_id=user_id, session_id=sid)
                await self._commit_repo(repo)
        finally:
            await self._close_repo(repo)

        # Create service instances
        asr = asr_service or (self._asr_service_factory() if self._asr_service_factory else None)
        llm = llm_service or (self._llm_service_factory() if self._llm_service_factory else None)
        tts = tts_service or (self._tts_service_factory() if self._tts_service_factory else None)
        retrieval = retrieval_service or (
            await self._retrieval_service_factory() if self._retrieval_service_factory else None
        )

        session = ConversationSession(
            session_id=sid,
            user_id=user_id,
            avatar_id=avatar_id,
            asr_service=asr,
            llm_service=llm,
            tts_service=tts,
            retrieval_service=retrieval,
        )
        session.on_cleanup = on_cleanup
        self._sessions[sid] = session

        if voice_id and hasattr(session.pipeline._tts, "voice"):
            try:
                session.pipeline._tts.voice = voice_id
                logger.info(f"Session TTS voice set | id={sid} | voice={voice_id}")
            except Exception as e:
                logger.warning(f"Failed to set TTS voice: {e}")

        connected_count = sum(1 for s in self._sessions.values() if s.connected)
        logger.info(
            f"Session created | id={sid} | user={user_id} | avatar={avatar_id} | "
            f"voice={voice_id or 'default'} | active_ws={connected_count} | resumable={len(self._sessions)}"
        )
        return session

    async def get_session(self, session_id: str) -> ConversationSession | None:
        parsed_session_id = parse_uuid(session_id)
        if parsed_session_id is None:
            return None
        session_id = str(parsed_session_id)
        session = self._sessions.get(session_id)
        if session:
            session.touch()
        return session

    async def connect_existing_session(self, session_id: str) -> ConversationSession | None:
        parsed_session_id = parse_uuid(session_id)
        if parsed_session_id is None:
            return None
        session_id = str(parsed_session_id)
        session = self._sessions.get(session_id)
        if session:
            session.mark_connected()
        return session

    async def disconnect_session(self, session_id: str) -> None:
        parsed_session_id = parse_uuid(session_id)
        if parsed_session_id is None:
            return
        session_id = str(parsed_session_id)
        session = self._sessions.get(session_id)
        if session is None:
            return
        session.pipeline.abort()
        session.mark_disconnected()
        connected_count = sum(1 for s in self._sessions.values() if s.connected)
        logger.info(
            f"Session disconnected | id={session_id} | "
            f"active_ws={connected_count} | resumable={len(self._sessions)}"
        )

    async def remove_session(self, session_id: str) -> None:
        parsed_session_id = parse_uuid(session_id)
        if parsed_session_id is None:
            return
        session_id = str(parsed_session_id)
        async with self._lock:
            if session_id in self._sessions:
                session = self._sessions[session_id]
                session.cleanup()
                del self._sessions[session_id]
        logger.info(f"Session removed | id={session_id}")

    async def cleanup_idle(self) -> int:
        idle_ids = [sid for sid, s in self._sessions.items() if s.idle_seconds > self._timeout]
        for sid in idle_ids:
            await self.remove_session(sid)
        if idle_ids:
            logger.info(f"Cleaned up {len(idle_ids)} idle sessions")
        return len(idle_ids)

    async def abort_session(self, session_id: str, message_id: str) -> None:
        parsed_session_id = parse_uuid(session_id)
        if parsed_session_id is None:
            return
        session_id = str(parsed_session_id)
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

    @property
    def active_count(self) -> int:
        """Count only sessions with an active WebSocket connection."""
        return sum(1 for s in self._sessions.values() if s.connected)

    @property
    def total_count(self) -> int:
        """Count all sessions (connected + resumable)."""
        return len(self._sessions)

    async def get_stats(self) -> dict:
        async with self._lock:
            sessions_info = [
                {
                    "id": sid,
                    "user_id": s.user_id,
                    "avatar": s.avatar_id,
                    "connected": s.connected,
                    "idle_sec": round(s.idle_seconds, 1),
                    "history_length": s.pipeline.history_length,
                }
                for sid, s in self._sessions.items()
            ]
        return {
            "active_sessions": len(self._sessions),
            "sessions": sessions_info,
        }
