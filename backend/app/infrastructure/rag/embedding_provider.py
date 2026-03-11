"""Stub embedder for future RAG implementation."""

from __future__ import annotations

from app.domain.rag.ports import EmbedderPort


class StubEmbedder(EmbedderPort):
    """No-op embedder — returns empty vectors."""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [[] for _ in texts]
