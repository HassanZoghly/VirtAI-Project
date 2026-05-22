from loguru import logger

from app.domain.rag.entities import DocumentChunk
from app.domain.rag.ports import EmbeddingProvider
from app.infrastructure.db.database import AsyncSessionLocal
from app.infrastructure.vector.pgvector_store import PGVectorStore


class RetrievalUseCase:
    """Orchestrates embedding the query and retrieving chunks via VectorStore."""

    def __init__(self, embedder: EmbeddingProvider):
        self.embedder = embedder

    async def retrieve(self, query: str, top_k: int = 5) -> list[DocumentChunk]:
        """Retrieves relevant chunks as DocumentChunk objects."""
        if not query.strip():
            return []

        try:
            logger.info(f"Retrieving chunks for query: {query[:50]}")
            query_vector = await self.embedder.embed(query)

            async with AsyncSessionLocal() as db:
                vector_store = PGVectorStore(db)
                results = await vector_store.search(query_vector, limit=top_k)

            # Return just the chunks (strip similarity scores)
            return [chunk for chunk, score in results]

        except Exception as e:
            logger.error(f"Retrieval failed: {e}")
            return []

    async def inject_context(self, query: str, system_prompt: str, top_k: int = 5) -> str:
        """Retrieves relevant chunks and injects them into the system prompt."""
        chunks = await self.retrieve(query, top_k=top_k)

        if not chunks:
            return system_prompt

        context_parts = []
        for chunk in chunks:
            source = chunk.metadata.get("filename", "Unknown") if chunk.metadata else "Unknown"
            context_parts.append(f"--- Source: {source} ---\n{chunk.chunk_text}")

        context_block = "\n\n".join(context_parts)

        injected = (
            f"{system_prompt}\n\n"
            f"### Retrieved Context ###\n"
            f"{context_block}\n"
            f"### End Context ###\n\n"
            f"Use the above context to answer the user's question accurately. "
            f"Ground your answer in the provided context."
        )
        return injected

    async def execute(self, query: str, limit: int = 5) -> str:
        """Retrieves relevant chunks and formats them as a context string."""
        if not query.strip():
            return ""

        try:
            logger.info(f"Retrieving context for query: {query[:50]}")
            query_vector = await self.embedder.embed(query)

            async with AsyncSessionLocal() as db:
                vector_store = PGVectorStore(db)
                results = await vector_store.search(query_vector, limit=limit)

            if not results:
                return ""

            # Format chunks into a single context string
            context_parts = []
            for chunk, score in results:
                source = chunk.metadata.get("filename", "Unknown") if chunk.metadata else "Unknown"
                context_parts.append(f"--- Document: {source} ---\n{chunk.chunk_text}\n")

            return "\n".join(context_parts)

        except Exception as e:
            logger.error(f"Retrieval failed: {e}")
            return ""
