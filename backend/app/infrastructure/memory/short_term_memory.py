from typing import Any

from app.domain.rag.entities import MemoryEntry


class ShortTermMemory:
    """
    In-memory conversation store scoped to a session.
    Lives as long as the process runs.
    """

    def __init__(self, max_entries: int = 20):
        self._store: dict[str, list[MemoryEntry]] = {}
        self.max_entries = max_entries

    def store(
        self, session_id: str, role: str, content: str, metadata: dict[str, Any] | None = None
    ) -> MemoryEntry:
        entry = MemoryEntry(
            session_id=session_id,
            role=role,
            content=content,
            metadata=metadata or {},
        )
        if session_id not in self._store:
            self._store[session_id] = []

        self._store[session_id].append(entry)

        # Keep only last N entries
        if len(self._store[session_id]) > self.max_entries:
            self._store[session_id] = self._store[session_id][-self.max_entries :]

        return entry

    def retrieve(self, session_id: str, last_n: int | None = None) -> list[MemoryEntry]:
        entries = self._store.get(session_id, [])
        if last_n:
            return entries[-last_n:]
        return entries

    def get_as_chat_history(self, session_id: str, last_n: int = 6) -> list[dict[str, str]]:
        """
        Returns memory entries formatted as LLM chat history.
        """
        entries = self.retrieve(session_id, last_n=last_n)
        return [{"role": e.role, "content": e.content} for e in entries]

    def clear(self, session_id: str) -> None:
        self._store.pop(session_id, None)

    def session_exists(self, session_id: str) -> bool:
        return session_id in self._store
