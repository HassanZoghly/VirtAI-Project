from loguru import logger

from app.domain.rag.entities import DocumentChunk
from app.domain.rag.ports import EmbeddingProvider, VectorStore, RerankerPort


from app.application.rag.token_budget import TokenBudgetManager


class RetrievalUseCase:
    """Orchestrates embedding the query and retrieving chunks via VectorStore."""

    def __init__(
        self,
        embedder: EmbeddingProvider,
        vector_store: VectorStore,
        reranker: RerankerPort | None = None,
        budget_manager: TokenBudgetManager | None = None
    ):
        self.embedder = embedder
        self.vector_store = vector_store
        self.reranker = reranker
        self.budget_manager = budget_manager

    async def retrieve(self, query: str, top_k: int = 5, session_id: str | None = None) -> list[DocumentChunk]:
        """Retrieves relevant chunks via hybrid search and optional reranking."""
        if not query.strip():
            return []

        try:
            logger.info(f"Retrieving chunks for query: {query[:50]}")
            query_vector = await self.embedder.embed(query)

            # 1. Hybrid Search
            results = await self.vector_store.hybrid_search(
                query_text=query,
                query_vector=query_vector,
                limit=top_k * 2,  # fetch more for reranking
                scope_id=session_id
            )
            
            if not results:
                return []
                
            chunks = [chunk for chunk, _ in results]

            # 2. Reranking
            if self.reranker:
                ranked_results = await self.reranker.rerank(query=query, chunks=chunks, top_k=top_k)
                chunks = [chunk for chunk, _ in ranked_results]
            else:
                chunks = chunks[:top_k]

            return chunks

        except Exception as e:
            logger.error(f"Retrieval failed: {e}")
            return []

    async def inject_context(
        self, 
        query: str, 
        system_prompt: str, 
        top_k: int = 5, 
        session_id: str | None = None,
        max_context_tokens: int = 4000
    ) -> str:
        """Retrieves relevant chunks and injects them into the system prompt."""
        chunks = await self.retrieve(query, top_k=top_k, session_id=session_id)

        if not chunks:
            return system_prompt
            
        if self.budget_manager:
            chunks = self.budget_manager.fit_chunks_to_budget(
                chunks=chunks,
                system_prompt=system_prompt,
                user_query=query,
                max_context_tokens=max_context_tokens
            )

        context_parts = []
        for chunk in chunks:
            source = chunk.metadata.get("filename", "Unknown") if chunk.metadata else "Unknown"
            context_parts.append(f"--- Document: {source} ---\n{chunk.chunk_text}")

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

    async def execute(self, query: str, limit: int = 5, session_id: str | None = None) -> str:
        """Retrieves relevant chunks and formats them as a context string."""
        if not query.strip():
            return ""

        try:
            logger.info(f"Retrieving context for query: {query[:50]}")
            chunks = await self.retrieve(query, top_k=limit, session_id=session_id)

            if not chunks:
                return ""

            # Format chunks into a single context string
            context_parts = []
            for chunk in chunks:
                source = chunk.metadata.get("filename", "Unknown") if chunk.metadata else "Unknown"
                context_parts.append(f"--- Document: {source} ---\n{chunk.chunk_text}\n")

            return "\n".join(context_parts)

        except Exception as e:
            logger.error(f"Retrieval failed: {e}")
            return ""
