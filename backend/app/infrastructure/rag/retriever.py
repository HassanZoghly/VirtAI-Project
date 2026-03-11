"""Stub retriever for future RAG implementation."""

from __future__ import annotations

from app.domain.rag.entities import DocumentChunk
from app.domain.rag.ports import RetrieverPort


class StubRetriever(RetrieverPort):
    """No-op retriever — returns empty results."""

    async def retrieve(self, query: str, top_k: int = 5) -> list[DocumentChunk]:
        return []
