"""
Context retrieval use case — stub for future RAG pipeline.
"""

from __future__ import annotations

from loguru import logger

from app.domain.rag.entities import DocumentChunk
from app.domain.rag.ports import RetrieverPort


class RetrieveContext:
    """Retrieves relevant document chunks for a query."""

    def __init__(self, retriever: RetrieverPort) -> None:
        self._retriever = retriever

    async def execute(self, query: str, top_k: int = 5) -> list[DocumentChunk]:
        """
        Retrieve the most relevant chunks for a natural language query.

        Args:
            query: Natural language search query.
            top_k: Maximum number of chunks to return.

        Returns:
            List of relevant DocumentChunk objects.
        """
        results = await self._retriever.retrieve(query, top_k=top_k)
        logger.debug(f"Retrieved {len(results)} chunks for query '{query[:50]}'")
        return results
