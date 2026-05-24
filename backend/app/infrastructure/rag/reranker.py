import asyncio

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


import threading
from concurrent.futures import ThreadPoolExecutor


class CrossEncoderReranker(RerankerPort):
    _model_instance = None
    _model_name_cache = None
    _init_lock = threading.Lock()
    _executor: ThreadPoolExecutor | None = None

    @classmethod
    def get_executor(cls) -> ThreadPoolExecutor:
        if cls._executor is None:
            with cls._init_lock:
                if cls._executor is None:
                    cls._executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="crossencoder")
        return cls._executor

    @classmethod
    def shutdown_executor(cls) -> None:
        with cls._init_lock:
            if cls._executor is not None:
                cls._executor.shutdown(wait=True)
                cls._executor = None

    def __init__(self, model_name: str = "BAAI/bge-reranker-base"):
        self.model_name = model_name
        with self._init_lock:
            if (
                CrossEncoderReranker._model_instance is not None
                and CrossEncoderReranker._model_name_cache == self.model_name
            ):
                self.model = CrossEncoderReranker._model_instance
                logger.debug("CrossEncoder loaded from singleton cache.")
                return

            from sentence_transformers import CrossEncoder

            logger.info(f"[Reranker] Loading CrossEncoder model={model_name}")
            self.model = CrossEncoder(model_name)
            CrossEncoderReranker._model_instance = self.model
            CrossEncoderReranker._model_name_cache = self.model_name
            logger.info(f"[Reranker] Successfully loaded {model_name}")

    def _rerank_sync(
        self, query: str, chunks: list[DocumentChunk], top_k: int
    ) -> list[tuple[DocumentChunk, float]]:
        if not chunks:
            return []

        pairs = [[query, chunk.chunk_text] for chunk in chunks]
        scores = self.model.predict(pairs)

        ranked = sorted(zip(chunks, (float(s) for s in scores)), key=lambda x: x[1], reverse=True)
        return ranked[:top_k]

    async def rerank(
        self, query: str, chunks: list[DocumentChunk], top_k: int = 5
    ) -> list[tuple[DocumentChunk, float]]:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(self.get_executor(), self._rerank_sync, query, chunks, top_k)
