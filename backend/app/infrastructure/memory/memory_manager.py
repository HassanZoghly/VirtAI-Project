from typing import Any

from app.domain.rag.ports import MemoryManagerPort
from app.infrastructure.db.repositories.conversation_repository import ConversationRepository
from app.infrastructure.memory.long_term_memory import LongTermMemory
from app.infrastructure.memory.semantic_memory_store import SemanticMemoryStore
from app.infrastructure.memory.short_term_memory import ShortTermMemory


class MemoryManager(MemoryManagerPort):
    """
    Unified memory interface.

    Short-term  → fast, in-process, per-session ring buffer
    Long-term   → persistent postgres via injected repository
    """

    def __init__(
        self,
        conversation_repo: ConversationRepository,
        semantic_store: SemanticMemoryStore | None = None,
        max_short_term_entries: int = 20,
    ):
        self.short_term = ShortTermMemory(max_entries=max_short_term_entries)
        self.long_term = LongTermMemory(conversation_repo=conversation_repo)
        self.semantic_store = semantic_store

    async def save_interaction(
        self,
        session_id: str,
        project_id: int,
        user_query: str,
        assistant_answer: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        # short term (sync, instant)
        self.short_term.store(session_id, "user", user_query)
        self.short_term.store(session_id, "assistant", assistant_answer)

        # semantic memory (background)
        if self.semantic_store:
            self.semantic_store.store_background(session_id, "user", user_query)
            self.semantic_store.store_background(session_id, "assistant", assistant_answer)

        # long term (async, persisted to postgres)
        await self.long_term.store(
            session_id=session_id,
            project_id=project_id,
            role="user",
            content=user_query,
            metadata=metadata,
        )
        await self.long_term.store(
            session_id=session_id,
            project_id=project_id,
            role="assistant",
            content=assistant_answer,
            metadata=metadata,
        )

    async def get_context(
        self,
        session_id: str,
        project_id: int,
        query: str,
        last_n: int = 6,
        semantic_n: int = 4,
    ) -> list[dict[str, str]]:
        """
        Returns merged context:
        - recent short-term history
        - relevant long-term memory
        """
        # 1. recent turns from short-term
        recent = self.short_term.get_as_chat_history(session_id=session_id, last_n=last_n)

        # 2. search long-term for relevant past messages
        relevant = []
        if self.semantic_store:
            relevant = await self.semantic_store.search(
                session_id=session_id, query=query, limit=semantic_n
            )
        else:
            relevant = await self.long_term.search(
                session_id=session_id,
                project_id=project_id,
                query=query,
                limit=semantic_n,
            )

        # 3. merge — deduplicate by content
        seen = {m["content"] for m in recent}
        merged = list(recent)

        for entry in relevant:
            if entry["content"] not in seen:
                seen.add(entry["content"])
                merged.append(
                    {
                        "role": entry["role"],
                        "content": entry["content"],
                    }
                )

        return merged

    async def get_history(
        self,
        session_id: str,
        project_id: int,
        last_n: int = 20,
    ) -> list[dict[str, str]]:
        return await self.long_term.get_history(
            session_id=session_id,
            project_id=project_id,
            last_n=last_n,
        )

    async def clear_session(self, session_id: str, project_id: int) -> None:
        self.short_term.clear(session_id)
        await self.long_term.delete_session(session_id, project_id)
