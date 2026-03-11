"""RAG subdomain — retrieval-augmented generation (stubs)."""

from app.domain.rag.entities import Citation, DocumentChunk, Source
from app.domain.rag.policies import (
    CHUNK_OVERLAP,
    CHUNK_SIZE,
    EMBEDDING_DIMENSION,
    EMBEDDING_MODEL,
    RERANK_ENABLED,
    SIMILARITY_THRESHOLD,
    TOP_K,
)
from app.domain.rag.ports import EmbedderPort, RetrieverPort, VectorStorePort

__all__ = [
    "DocumentChunk",
    "Citation",
    "Source",
    "EmbedderPort",
    "VectorStorePort",
    "RetrieverPort",
    "CHUNK_SIZE",
    "CHUNK_OVERLAP",
    "TOP_K",
    "SIMILARITY_THRESHOLD",
    "RERANK_ENABLED",
    "EMBEDDING_MODEL",
    "EMBEDDING_DIMENSION",
]
