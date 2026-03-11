"""
Document ingestion use case — stub for future RAG pipeline.
"""

from __future__ import annotations

from loguru import logger

from app.domain.rag.entities import DocumentChunk, Source
from app.domain.rag.ports import EmbedderPort, VectorStorePort


class IngestDocuments:
    """Splits documents into chunks, embeds them, and stores in vector store."""

    def __init__(self, embedder: EmbedderPort, store: VectorStorePort) -> None:
        self._embedder = embedder
        self._store = store

    async def execute(self, source: Source, chunks: list[DocumentChunk]) -> int:
        """
        Embed and store document chunks.

        Args:
            source: Metadata about the document being ingested.
            chunks: Pre-split document chunks.

        Returns:
            Number of chunks stored.
        """
        if not chunks:
            return 0

        texts = [c.text for c in chunks]
        embeddings = await self._embedder.embed(texts)

        for chunk, emb in zip(chunks, embeddings):
            chunk.embedding = emb

        await self._store.add(chunks)
        logger.info(f"Ingested {len(chunks)} chunks from '{source.name}'")
        return len(chunks)
