from abc import ABC, abstractmethod
from typing import Any, List, Optional
from uuid import UUID

from app.domain.rag.entities import Document, DocumentChunk


# ── Agentic RAG Ports (from RAG_project integration) ────────────────────────


class LLMGenerationProvider(ABC):
    """
    Port for text-generation LLM providers (OpenAI, Cohere, etc.).

    This is distinct from the chat-focused BaseLLMProvider in domain/chat/ports.py.
    It serves the agentic RAG pipeline (answer, summarize, quiz generation)
    using a synchronous-style API with prompt+chat_history.
    """

    @abstractmethod
    def set_generation_model(self, model_id: str) -> None: ...

    @abstractmethod
    def set_embedding_model(self, model_id: str, embedding_size: int) -> None: ...

    @abstractmethod
    def generate_text(
        self,
        prompt: str,
        chat_history: list | None = None,
        max_output_tokens: int | None = None,
        temperature: float | None = None,
    ) -> str | None: ...

    @abstractmethod
    def generate_stream(
        self,
        prompt: str,
        chat_history: list | None = None,
        max_output_tokens: int | None = None,
        temperature: float | None = None,
    ): ...

    @abstractmethod
    def embed_text(self, text: str | list[str], document_type: str | None = None) -> Any: ...

    @abstractmethod
    def construct_prompt(self, prompt: str, role: str) -> dict: ...

    @abstractmethod
    def process_text(self, text: str) -> str: ...


class VectorCollectionStore(ABC):
    """
    Port for dynamic-collection vector storage (PGVector collections, Qdrant).

    This is distinct from the VectorStore port below, which operates on the
    single `document_chunks` table. This port manages named collections
    with raw SQL tables or external vector DBs.
    """

    @abstractmethod
    async def connect(self) -> None: ...

    @abstractmethod
    async def disconnect(self) -> None: ...

    @abstractmethod
    async def is_collection_existed(self, collection_name: str) -> bool: ...

    @abstractmethod
    async def list_all_collections(self) -> list: ...

    @abstractmethod
    async def get_collection_info(self, collection_name: str) -> dict | None: ...

    @abstractmethod
    async def delete_collection(self, collection_name: str) -> bool: ...

    @abstractmethod
    async def create_collection(
        self,
        collection_name: str,
        embedding_size: int,
        do_reset: bool = False,
    ) -> bool: ...

    @abstractmethod
    async def insert_one(
        self,
        collection_name: str,
        text: str,
        vector: list,
        metadata: dict | None = None,
        record_id: str | None = None,
    ) -> bool: ...

    @abstractmethod
    async def insert_many(
        self,
        collection_name: str,
        texts: list,
        vectors: list,
        metadata: list | None = None,
        record_ids: list | None = None,
        batch_size: int = 50,
    ) -> bool: ...

    @abstractmethod
    async def search_by_vector(
        self,
        collection_name: str,
        vector: list,
        limit: int = 5,
    ) -> list: ...


# ── Existing Ingestion Pipeline Ports ────────────────────────────────────────


class EmbeddingProvider(ABC):
    @abstractmethod
    async def embed(self, text: str) -> list[float]:
        pass

    @abstractmethod
    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
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


class ChunkingStrategy(ABC):
    @abstractmethod
    def chunk(self, text: str) -> list[str]:
        pass


class DocumentRepositoryPort(ABC):
    """Abstract interface for document persistence operations."""

    @abstractmethod
    async def create(self, user_id: str, filename: str, file_type: str, session_id: str | None = None) -> Document: ...

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
