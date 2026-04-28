"""
WebSocket connection manager with lightweight outbound replay support.

Responsibilities:
- Track the active socket per session
- Keep a short history of outbound messages for reconnect resume
- Provide per-session sequence numbers for ordered replay
"""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict, deque
from typing import Any

from fastapi import WebSocket


class WSConnectionManager:
    def __init__(self, history_size: int = 200):
        self._history_size = history_size
        self._active: dict[str, WebSocket] = {}
        self._history: dict[str, deque[tuple[int, str]]] = defaultdict(
            lambda: deque(maxlen=self._history_size)
        )
        self._seq: dict[str, int] = defaultdict(int)
        self._acked: dict[str, int] = defaultdict(int)
        self._lock = asyncio.Lock()

    async def register(self, session_id: str, websocket: WebSocket) -> None:
        """Register/replace active websocket for a session."""
        async with self._lock:
            old = self._active.get(session_id)
            self._active[session_id] = websocket

        if old and old is not websocket:
            try:
                await old.close(code=1012, reason="Replaced by new connection")
            except Exception:
                pass

    async def unregister(self, session_id: str, websocket: WebSocket) -> None:
        """Unregister socket only if it is still the active one."""
        async with self._lock:
            current = self._active.get(session_id)
            if current is websocket:
                self._active.pop(session_id, None)

    async def stamp_and_record(self, session_id: str, payload: dict[str, Any]) -> str:
        """Attach seq_id, persist message to replay history, and return serialized JSON."""
        async with self._lock:
            self._seq[session_id] += 1
            seq = self._seq[session_id]
            payload["seq_id"] = seq
            serialized = json.dumps(payload)
            self._history[session_id].append((seq, serialized))
            return serialized

    async def record_outbound(self, session_id: str, payload: str, seq: int | None = None) -> int:
        """Record an already serialized payload and return sequence number."""
        async with self._lock:
            if seq is None:
                self._seq[session_id] += 1
                seq = self._seq[session_id]
            else:
                self._seq[session_id] = max(self._seq[session_id], seq)
            self._history[session_id].append((seq, payload))
            return seq

    async def acknowledge(self, session_id: str, last_seq: int) -> int:
        """Persist client ACK and trim replay history for acknowledged messages."""
        async with self._lock:
            if last_seq <= self._acked[session_id]:
                return 0

            self._acked[session_id] = last_seq
            history = self._history.get(session_id)
            if not history:
                return 0

            removed = 0
            while history and history[0][0] <= last_seq:
                history.popleft()
                removed += 1
            return removed

    async def get_replay_batch(self, session_id: str, after_seq: int = 0) -> list[str]:
        """Return ordered payloads newer than after_seq for reconnect replay."""
        async with self._lock:
            return [
                payload for seq, payload in self._history.get(session_id, ()) if seq > after_seq
            ]

    @property
    def active_count(self) -> int:
        return len(self._active)

    def latest_sequence(self, session_id: str) -> int:
        return self._seq.get(session_id, 0)

    def latest_acked(self, session_id: str) -> int:
        return self._acked.get(session_id, 0)


_connection_manager: WSConnectionManager | None = None


def init_connection_manager(manager: WSConnectionManager) -> None:
    global _connection_manager
    _connection_manager = manager


def get_connection_manager() -> WSConnectionManager:
    if _connection_manager is None:
        raise RuntimeError("Connection manager not initialized")
    return _connection_manager
