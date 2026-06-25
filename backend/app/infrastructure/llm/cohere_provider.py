"""
Cohere text generation, embedding, and reranking provider.

Serves the agentic RAG pipeline. Cohere is the only provider
that also supports reranking, which is used by RetrieverAgent
and SummarizerAgent for result quality improvement.
"""

from __future__ import annotations

from typing import Any, Union

import cohere  # type: ignore[import-not-found]
from loguru import logger

from app.domain.chat.ports import BaseLLMProvider
from app.infrastructure.llm.enums import CoHereRole, DocumentTypeEnum


class CoHereProvider(BaseLLMProvider):
    """
    Cohere provider implementing generation, embedding, and reranking.

    The reranker capability is exposed as an additional ``rerank()`` method
    beyond what the LLMGenerationProvider port requires, because it is
    a Cohere-specific feature used by the retrieval pipeline.
    """

    def __init__(
        self,
        api_key: str,
        default_input_max_characters: int = 40000,
        default_generation_max_output_tokens: int = 3000,
        default_generation_temperature: float = 0.1,
    ):
        self.api_key = api_key
        self.default_input_max_characters = default_input_max_characters
        self.default_generation_max_output_tokens = default_generation_max_output_tokens
        self.default_generation_temperature = default_generation_temperature

        self.generation_model_id: str | None = None
        self.embedding_model_id: str | None = None
        self.rerank_model_id: str | None = None
        self.embedding_size: int | None = None

        self.client = cohere.Client(api_key=self.api_key)
        self.enums = CoHereRole

    # ── Configuration ────────────────────────────────────────────────────

    def set_generation_model(self, model_id: str) -> None:
        self.generation_model_id = model_id

    def set_embedding_model(self, model_id: str, embedding_size: int) -> None:
        self.embedding_model_id = model_id
        self.embedding_size = embedding_size

    def set_rerank_model(self, model_id: str) -> None:
        self.rerank_model_id = model_id

    # ── Text processing ──────────────────────────────────────────────────

    def process_text(self, text: str) -> str:
        return text[: self.default_input_max_characters].strip()

    # ── Generation ───────────────────────────────────────────────────────

    async def generate_text(
        self,
        prompt: str,
        chat_history: list | None = None,
        max_output_tokens: int | None = None,
        temperature: float | None = None,
        **kwargs: Any,
    ) -> str | None:
        if not self.client or not self.generation_model_id:
            logger.error("Cohere client or generation model not configured")
            return None

        chat_history = list(chat_history) if chat_history else []
        max_output_tokens = max_output_tokens or self.default_generation_max_output_tokens
        temperature = temperature or self.default_generation_temperature

        response = self.client.chat(
            model=self.generation_model_id,
            chat_history=chat_history,
            message=self.process_text(prompt),
            temperature=temperature,
            max_tokens=max_output_tokens,
        )

        return response.text if response else None

    async def generate_stream(
        self,
        prompt: str,
        chat_history: list | None = None,
        max_output_tokens: int | None = None,
        temperature: float | None = None,
        **kwargs: Any,
    ):
        """Yields text chunks from a streaming Cohere completion."""
        if not self.client or not self.generation_model_id:
            yield "Error: Cohere client or model not configured."
            return

        chat_history = list(chat_history) if chat_history else []
        max_output_tokens = max_output_tokens or self.default_generation_max_output_tokens
        temperature = temperature or self.default_generation_temperature

        try:
            response = self.client.chat_stream(
                model=self.generation_model_id,
                chat_history=chat_history,
                message=self.process_text(prompt),
                temperature=temperature,
                max_tokens=max_output_tokens,
            )
            for event in response:
                if event.event_type == "text-generation":
                    yield event.text
        except Exception as e:
            logger.error(f"Cohere streaming error: {e}")
            yield f"Error: {e}"

    # ── Reranking (Cohere-specific capability) ───────────────────────────

    def rerank(self, query: str, documents: list[str], top_n: int = 3) -> list[str]:
        """
        Rerank documents by relevance to the query.

        Falls back to a simple top-N slice if the rerank model is not configured.
        """
        if not self.client or not self.rerank_model_id:
            logger.warning("Cohere rerank model not configured — falling back to top-N")
            return documents[:top_n]

        try:
            response = self.client.rerank(
                model=self.rerank_model_id,
                query=query,
                documents=documents,
                top_n=top_n,
            )
            return [documents[res.index] for res in response.results]
        except Exception as e:
            logger.error(f"Cohere reranking error: {e}")
            return documents[:top_n]

    # ── Embedding ────────────────────────────────────────────────────────

    async def embed_text(
        self, text: Union[str, list[str]], document_type: str | None = None
    ) -> list[list[float]] | None:
        if not self.client or not self.embedding_model_id:
            logger.error("Cohere embedding model not configured")
            return None

        if isinstance(text, str):
            text = [text]

        input_type = (
            CoHereRole.QUERY.value
            if document_type == DocumentTypeEnum.QUERY
            else CoHereRole.DOCUMENT.value
        )

        response = self.client.embed(
            model=self.embedding_model_id,
            texts=[self.process_text(t) for t in text],
            input_type=input_type,
            embedding_types=["float"],
        )

        if not response:
            return None
        return [[float(x) for x in embedding] for embedding in response.embeddings]

    # ── Prompt construction ──────────────────────────────────────────────

    def construct_prompt(self, prompt: str, role: str) -> dict:
        # Cohere API requires 'message' key, not 'content'
        return {"role": role, "message": prompt}
