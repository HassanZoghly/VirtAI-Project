from loguru import logger

from app.application.rag.token_budget import TokenBudgetManager
from app.domain.rag.entities import DocumentChunk, RetrievalResult, RetrievalStatus, RetrievedDocument
from app.domain.rag.ports import EmbeddingProvider, RerankerPort, VectorStore
from app.shared.ids import parse_uuid


class RetrievalError(Exception):
    pass


class RetrievalUseCase:
    """Orchestrates embedding the query and retrieving chunks via VectorStore."""

    def __init__(
        self,
        embedder: EmbeddingProvider,
        vector_store: VectorStore,
        reranker: RerankerPort | None = None,
        budget_manager: TokenBudgetManager | None = None,
    ):
        self.embedder = embedder
        self.vector_store = vector_store
        self.reranker = reranker
        self.budget_manager = budget_manager

    async def retrieve(
        self, query: str, top_k: int = 5, session_id: str | None = None
    ) -> RetrievalResult:
        """Retrieves relevant chunks via hybrid search and optional reranking."""
        if not query.strip():
            return RetrievalResult(status=RetrievalStatus.NO_RESULTS)

        try:
            logger.info(f"Retrieving chunks for query: {query[:50]}")
            query_vector = await self.embedder.embed(query)
            scope_uuid = parse_uuid(session_id) if session_id else None

            # 1. Hybrid Search
            results = await self.vector_store.hybrid_search(
                query_text=query,
                query_vector=query_vector,
                limit=top_k * 3,  # fetch more for diversity and reranking
                scope_id=scope_uuid,
            )

            if not results:
                return RetrievalResult(status=RetrievalStatus.NO_RESULTS)

            chunks = [chunk for chunk, _ in results]

            # 2. Reranking
            if self.reranker:
                try:
                    ranked_results = await self.reranker.rerank(query=query, chunks=chunks, top_k=top_k * 2)
                    results = ranked_results
                except Exception as e:
                    logger.error(f"Reranker failed: {e}. Falling back to un-reranked results.")
            
            # 3. Apply max chunks per source diversity
            final_chunks = []
            source_counts = {}
            max_per_source = 3
            
            for chunk, score in results:
                source = chunk.metadata.get("filename", "Unknown") if chunk.metadata else "Unknown"
                if source_counts.get(source, 0) < max_per_source:
                    source_counts[source] = source_counts.get(source, 0) + 1
                    final_chunks.append(RetrievedDocument(
                        text=chunk.chunk_text,
                        score=score,
                        metadata=chunk.metadata,
                        id=str(chunk.id)
                    ))
                if len(final_chunks) >= top_k:
                    break
                    
            status = RetrievalStatus.SUCCESS
            if len(final_chunks) == 0:
                status = RetrievalStatus.NO_RESULTS
            elif final_chunks[0].score < 0.2:
                status = RetrievalStatus.LOW_CONFIDENCE
                
            return RetrievalResult(status=status, documents=final_chunks)

        except Exception as e:
            logger.error(f"Retrieval failed: {e}")
            return RetrievalResult(status=RetrievalStatus.FAILED)

    async def inject_context(
        self,
        query: str,
        system_prompt: str,
        top_k: int = 5,
        session_id: str | None = None,
        max_context_tokens: int = 4000,
    ) -> str:
        """Retrieves relevant chunks and injects them into the system prompt."""
        try:
            retrieval_result = await self.retrieve(query, top_k=top_k, session_id=session_id)
        except RetrievalError as e:
            logger.warning(f"Retrieval error: {e}", extra={"query": query})
            return system_prompt

        if retrieval_result.status in (RetrievalStatus.NO_RESULTS, RetrievalStatus.FAILED):
            return system_prompt

        chunks = retrieval_result.documents

        if self.budget_manager:
            chunks = self.budget_manager.fit_chunks_to_budget(
                chunks=chunks,
                system_prompt=system_prompt,
                user_query=query,
                max_context_tokens=max_context_tokens,
            )

        context_parts = []
        for chunk in chunks:
            source = chunk.metadata.get("filename", "Unknown") if chunk.metadata else "Unknown"
            context_parts.append(f"--- Document: {source} ---\n{chunk.text}")

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
            retrieval_result = await self.retrieve(query, top_k=limit, session_id=session_id)

            if retrieval_result.status in (RetrievalStatus.NO_RESULTS, RetrievalStatus.FAILED):
                return ""
                
            chunks = retrieval_result.documents
        except RetrievalError as e:
            logger.warning(f"Retrieval error: {e}", extra={"query": query})
            return ""

        if self.budget_manager and chunks:
            chunks = self.budget_manager.fit_chunks_to_budget(
                chunks=chunks,
                system_prompt="",
                user_query=query,
                max_context_tokens=3000,
            )

        # Format chunks into a single context string
        context_parts = []
        for chunk in chunks:
            source = chunk.metadata.get("filename", "Unknown") if chunk.metadata else "Unknown"
            context_parts.append(f"--- Document: {source} ---\n{chunk.text}\n")

        return "\n".join(context_parts)
