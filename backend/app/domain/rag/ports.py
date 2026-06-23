from abc import ABC, abstractmethod
from collections.abc import Sequence
from uuid import UUID

from app.domain.rag.entities import Document, DocumentChunk

# ── Existing Ingestion Pipeline Ports ────────────────────────────────────────


class EmbeddingProvider(ABC):
    @abstractmethod
    async def embed(self, text: str) -> list[float]:
        pass

    @abstractmethod
    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        pass

    @abstractmethod
    async def close(self) -> None:
        """Close resources."""
        pass


class VectorStore(ABC):

    @abstractmethod
    async def store_chunks_batch(
        self, chunks: list[DocumentChunk], embeddings: list[list[float]]
    ) -> None:
        pass

    @abstractmethod
    async def search(
        self,
        query_vector: list[float],
        limit: int = 5,
        document_id: UUID | None = None,
        scope: str | None = None,
        scope_id: UUID | None = None,
        min_dense_score: float = 0.5,
        metadata_filter: dict | None = None,
    ) -> list[tuple[DocumentChunk, float]]:
        pass

    @abstractmethod
    async def hybrid_search(
        self,
        query_text: str,
        query_vector: list[float],
        limit: int = 10,
        document_id: UUID | None = None,
        scope: str | None = None,
        scope_id: UUID | None = None,
        min_hybrid_score: float = 0.015,
        min_dense_score: float = 0.5,
        metadata_filter: dict | None = None,
    ) -> list[tuple[DocumentChunk, float]]:
        pass


class RerankerPort(ABC):
    """Abstract interface for a document reranker (e.g., Cross-Encoder)."""

    @abstractmethod
    async def rerank(
        self, query: str, chunks: list[DocumentChunk], top_k: int = 5
    ) -> list[tuple[DocumentChunk, float]]:
        pass


class DocumentParser(ABC):
    @abstractmethod
    async def parse(self, file_path: str, file_type: str) -> str:
        pass

    @abstractmethod
    async def parse_bytes(self, data: bytes, file_type: str) -> str:
        pass


class ChunkingStrategy(ABC):
    @abstractmethod
    def chunk(self, text: str) -> list[str]:
        pass


class DocumentRepositoryPort(ABC):
    """Abstract interface for document persistence operations."""

    @abstractmethod
    async def create(
        self, user_id: str, filename: str, file_type: str, session_id: str | None = None
    ) -> Document: ...

    @abstractmethod
    async def get(self, document_id: str) -> Document | None: ...

    @abstractmethod
    async def list_by_user(
        self, user_id: str, status: str | None = None, limit: int = 100
    ) -> Sequence[Document]: ...

    @abstractmethod
    async def update_status(
        self, document_id: str, status: str, chunk_count: int = 0
    ) -> Document | None: ...

    @abstractmethod
    async def delete(self, document_id: str) -> bool: ...

    @abstractmethod
    async def update_progress(self, document_id: str, stage: str, pct: int, processed: int, total: int) -> None: ...

    @abstractmethod
    async def get_next_chunk_version(self, document_id: str) -> int: ...

    @abstractmethod
    async def activate_chunk_version(self, document_id: str, new_version: int, expected_total: int) -> int: ...

    @abstractmethod
    async def delete_inactive_chunks(self, document_id: str, active_version: int | None = None) -> None: ...

    @abstractmethod
    async def update_content_hash(self, document_id: str, content_hash: str) -> None: ...

    @abstractmethod
    async def mark_completed(self, document_id: str) -> None: ...

    @abstractmethod
    async def delete_all_chunks(self, document_id: str) -> None: ...

    @abstractmethod
    async def delete_chunks_by_version(self, document_id: str, version: int) -> None: ...

    @abstractmethod
    async def has_any_chunks(self, document_id: str) -> bool: ...


class VisualizationProviderPort(ABC):
    """Abstract interface for external visual generation APIs (like Napkin)."""

    @abstractmethod
    async def generate_diagram(self, text: str) -> dict[str, str | bool]:
        """
        Takes raw text and generates an image URL.
        Returns a dictionary implementing the Sentinel pattern:
        e.g., {"image_url": "https/..."} OR {"unavailable": True, "reason": "timeout"}
        """
        pass

