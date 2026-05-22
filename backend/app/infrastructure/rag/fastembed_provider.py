import asyncio
import inspect
from pathlib import Path

from fastembed import TextEmbedding
from loguru import logger

from app.domain.rag.ports import EmbeddingProvider
from app.shared.config import get_settings


class FastEmbedProvider(EmbeddingProvider):
    def __init__(self, model_name: str = "BAAI/bge-small-en-v1.5", cache_dir: str | None = None):
        self.model_name = model_name
        settings = get_settings()
        self.cache_dir = cache_dir or settings.FASTEMBED_CACHE_DIR
        Path(self.cache_dir).mkdir(parents=True, exist_ok=True)

        # FastEmbed downloads and loads the model into memory synchronously on init.
        # Docker prewarms this cache; runtime startup should reuse it.
        logger.info(
            {
                "event": "fastembed_load_start",
                "model": model_name,
                "cache_dir": self.cache_dir,
            }
        )
        kwargs = {"model_name": self.model_name}
        signature = inspect.signature(TextEmbedding)
        if "cache_dir" in signature.parameters:
            kwargs["cache_dir"] = self.cache_dir
        if "lazy_load" in signature.parameters:
            kwargs["lazy_load"] = settings.FASTEMBED_LAZY_LOAD

        self.model = TextEmbedding(**kwargs)
        logger.info("FastEmbed model loaded successfully.")

    def _embed_sync(self, texts: list[str]) -> list[list[float]]:
        # FastEmbed returns a generator of numpy arrays, we convert to list of floats
        embeddings_gen = self.model.embed(texts)
        return [list(vec) for vec in embeddings_gen]

    async def embed(self, text: str) -> list[float]:
        loop = asyncio.get_running_loop()
        try:
            # Run the CPU-bound embedding in a thread pool
            result = await loop.run_in_executor(None, self._embed_sync, [text])
            return result[0]
        except Exception as e:
            logger.error(f"FastEmbed generation failed: {e}")
            raise RuntimeError(f"Embedding generation failed: {e}")

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        loop = asyncio.get_running_loop()
        try:
            return await loop.run_in_executor(None, self._embed_sync, texts)
        except Exception as e:
            logger.error(f"FastEmbed batch generation failed: {e}")
            raise RuntimeError(f"Batch embedding generation failed: {e}")
