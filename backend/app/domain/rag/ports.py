from abc import ABC, abstractmethod
from uuid import UUID

from app.domain.rag.entities import Document, DocumentChunk


class EmbeddingProvider(ABC):
    @abstractmethod
    async def embed(self, text: str) -> list[float]:
        pass

    @abstractmethod
    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        pass


class VectorStore(ABC):
    @abstractmethod
    async def store_chunk(self, chunk: DocumentChunk, embedding: list[float]) -> None:
        pass

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
    ) -> list[tuple[DocumentChunk, float]]:
        pass


class DocumentParser(ABC):
    @abstractmethod
    async def parse(self, file_path: str, file_type: str) -> str:
        pass


class ChunkingStrategy(ABC):
    @abstractmethod
    def chunk(self, text: str) -> list[str]:
        pass


class DocumentRepositoryPort(ABC):
    """Abstract interface for document persistence operations."""

    @abstractmethod
    async def create(self, user_id: str, filename: str, file_type: str) -> Document: ...

    @abstractmethod
    async def get(self, document_id: str) -> Document | None: ...

    @abstractmethod
    async def list_by_user(
        self, user_id: str, status: str | None = None, limit: int = 100
    ) -> list[Document]: ...

    @abstractmethod
    async def update_status(
        self, document_id: str, status: str, chunk_count: int = 0
    ) -> Document | None: ...

    @abstractmethod
    async def delete(self, document_id: str) -> bool: ...
