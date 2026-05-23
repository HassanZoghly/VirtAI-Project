from loguru import logger

from app.domain.rag.entities import DocumentChunk
from app.domain.rag.ports import RerankerPort


class DummyCrossEncoderReranker(RerankerPort):
    """
    A mock/lazy reranker to avoid heavy model downloads during refactoring.
    In a real scenario, this would load a CrossEncoder model.
    """
    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"):
        self.model_name = model_name
        self.is_loaded = False
        logger.info(f"[Reranker] Initialized lazy reranker with model={model_name}")

    def _load_model(self):
        if not self.is_loaded:
            logger.info(f"[Reranker] Simulated loading of {self.model_name}...")
            self.is_loaded = True

    async def rerank(
        self, query: str, chunks: list[DocumentChunk], top_k: int = 5
    ) -> list[tuple[DocumentChunk, float]]:
        self._load_model()
        
        if not chunks:
            return []

        # Simulated reranking: We simply preserve the input order or assign a fake score
        logger.debug(f"[Reranker] Reranking {len(chunks)} chunks for query: '{query}'")
        
        # In a real implementation:
        # scores = self.model.predict([(query, chunk.chunk_text) for chunk in chunks])
        # ranked = sorted(zip(chunks, scores), key=lambda x: x[1], reverse=True)
        
        # Fake score based on order (assuming input is pre-ranked by hybrid search)
        ranked = [(chunk, 1.0 - (i * 0.01)) for i, chunk in enumerate(chunks)]
        
        return ranked[:top_k]
