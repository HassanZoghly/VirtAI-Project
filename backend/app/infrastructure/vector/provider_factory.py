"""
Vector DB provider factory for the agentic RAG pipeline.

Selects and instantiates the correct VectorCollectionStore
implementation based on configuration.
"""

from __future__ import annotations

from loguru import logger

from app.domain.rag.ports import VectorCollectionStore
from app.infrastructure.vector.enums import VectorDBBackend
from app.shared.config import Settings


class VectorDBProviderFactory:
    """
    Creates VectorCollectionStore instances based on backend settings.

    Usage::

        factory = VectorDBProviderFactory(settings, db_client=session_factory)
        store = factory.create(provider="PGVECTOR")
        await store.connect()
    """

    def __init__(self, settings: Settings, db_client=None):
        self._settings = settings
        self._db_client = db_client

    def create(self, provider: str | None = None) -> VectorCollectionStore:
        """
        Instantiate a vector DB provider by name.

        Args:
            provider: One of "PGVECTOR" or "QDRANT" (case-insensitive).
                      Defaults to settings.VECTOR_DB_BACKEND.

        Raises:
            ValueError: If the provider is not recognized.
        """
        provider = (provider or self._settings.VECTOR_DB_BACKEND).strip().upper()

        if provider == VectorDBBackend.PGVECTOR:
            from app.infrastructure.vector.pgvector_collection import PGVectorCollectionProvider

            return PGVectorCollectionProvider(
                db_client=self._db_client,
                default_vector_size=self._settings.EMBEDDING_DIMENSION,
                distance_method=self._settings.VECTOR_DB_DISTANCE_METHOD,
                index_threshold=getattr(self._settings, "VECTOR_DB_PGVEC_INDEX_THRESHOLD", 100),
            )

        if provider == VectorDBBackend.QDRANT:
            from app.infrastructure.vector.qdrant_provider import QdrantProvider

            return QdrantProvider(
                db_path=getattr(self._settings, "VECTOR_DB_PATH", "./qdrant_data"),
                distance_method=self._settings.VECTOR_DB_DISTANCE_METHOD,
            )

        raise ValueError(
            f"Unsupported vector DB provider: '{provider}'. "
            f"Supported: {[e.value for e in VectorDBBackend]}"
        )
