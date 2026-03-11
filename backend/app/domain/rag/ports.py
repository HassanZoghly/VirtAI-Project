"""
RAG domain ports — abstract interfaces for embedding, vector storage, and retrieval.

These are stubs for future RAG implementation.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.domain.rag.entities import DocumentChunk


class EmbedderPort(ABC):
    """Abstract interface for text embedding."""

    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a list of text strings into vector representations."""
        ...


class VectorStorePort(ABC):
    """Abstract interface for vector storage."""

    @abstractmethod
    async def add(self, chunks: list[DocumentChunk]) -> None:
        """Add document chunks (with embeddings) to the store."""
        ...

    @abstractmethod
    async def search(self, query_vector: list[float], top_k: int = 5) -> list[DocumentChunk]:
        """Search for similar chunks by vector similarity."""
        ...

    @abstractmethod
    async def delete(self, chunk_ids: list[str]) -> None:
        """Delete chunks by their IDs."""
        ...


class RetrieverPort(ABC):
    """Abstract interface for end-to-end retrieval (embed query + search)."""

    @abstractmethod
    async def retrieve(self, query: str, top_k: int = 5) -> list[DocumentChunk]:
        """Retrieve the most relevant chunks for a natural language query."""
        ...
