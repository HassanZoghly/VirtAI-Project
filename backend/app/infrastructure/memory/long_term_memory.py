from typing import Any
from loguru import logger

from app.infrastructure.db.models import Conversation
from app.infrastructure.db.repositories.conversation_repository import ConversationRepository


class LongTermMemory:
    """
    Persists conversations to PostgreSQL.
    Vector search for memory is done via embedding similarity
    computed at query time (no separate vector collection for memory).
    """

    def __init__(self, conversation_repo: ConversationRepository):
        self.conversation_repo = conversation_repo

    async def store(
        self,
        session_id: str,
        project_id: int,
        role: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> Conversation | None:
        """Persist a single message to PostgreSQL only."""
        try:
            return await self.conversation_repo.save_message(
                session_id=session_id,
                project_id=project_id,
                role=role,
                content=content,
                vector_collection=None,
                metadata=metadata,
            )
        except Exception as e:
            logger.warning(f"[LongTermMemory] store failed: {e}")
            return None

    async def get_history(
        self, session_id: str, project_id: int, last_n: int = 10
    ) -> list[dict[str, str]]:
        """Ordered recent history from postgres."""
        try:
            rows = await self.conversation_repo.get_session_history(
                session_id=session_id,
                project_id=project_id,
                last_n=last_n,
            )
            return [{"role": r.role, "content": r.content} for r in rows]
        except Exception as e:
            logger.warning(f"[LongTermMemory] get_history failed: {e}")
            return []

    async def search(
        self, session_id: str, project_id: int, query: str, limit: int = 5
    ) -> list[dict[str, Any]]:
        """
        Search past conversations. Uses recent history
        since vector indexing of memory has compatibility issues
        with PGVector's foreign key constraints.
        """
        try:
            # get more history and let the caller filter
            rows = await self.conversation_repo.get_session_history(
                session_id=session_id,
                project_id=project_id,
                last_n=limit * 2,
            )

            results = []
            query_lower = query.lower()
            query_words = query_lower.split()

            for row in rows:
                content_lower = row.content.lower()
                # simple relevance: check if any query words appear
                matches = sum(1 for w in query_words if w in content_lower)
                if matches > 0:
                    results.append(
                        {
                            "role": row.role,
                            "content": row.content,
                            "score": matches / len(query_words) if query_words else 0,
                        }
                    )

            # sort by relevance score
            results.sort(key=lambda x: x["score"], reverse=True)
            return results[:limit]

        except Exception as e:
            logger.warning(f"[LongTermMemory] search failed: {e}")
            return []

    async def delete_session(self, session_id: str, project_id: int) -> int:
        try:
            return await self.conversation_repo.delete_session(session_id, project_id)
        except Exception as e:
            logger.warning(f"[LongTermMemory] delete failed: {e}")
            return 0
