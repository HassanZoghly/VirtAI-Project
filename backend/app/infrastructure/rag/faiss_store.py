"""Stub vector store for future FAISS-backed RAG implementation."""

from __future__ import annotations

from app.domain.rag.entities import DocumentChunk
from app.domain.rag.ports import VectorStorePort


class StubFaissStore(VectorStorePort):
    """No-op vector store — stores nothing, returns empty results."""

    async def add(self, chunks: list[DocumentChunk]) -> None:
        pass

    async def search(self, query_vector: list[float], top_k: int = 5) -> list[DocumentChunk]:
        return []

    async def delete(self, chunk_ids: list[str]) -> None:
        pass
