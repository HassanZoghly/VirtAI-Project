"""
Qdrant vector database provider for the agentic RAG pipeline.

Alternative to PGVector collections — uses the Qdrant client to
manage collections in an external Qdrant instance.
"""

from __future__ import annotations

from collections.abc import Callable

from loguru import logger
from qdrant_client import QdrantClient, models

from app.domain.rag.ports import VectorCollectionStore
from app.infrastructure.vector.enums import DistanceMethod
from app.infrastructure.vector.pgvector_collection import RetrievedDocument


class QdrantProvider(VectorCollectionStore):
    """
    Qdrant vector store implementing the VectorCollectionStore port.

    Uses qdrant-client to manage named collections with cosine or dot
    product distance. All operations are run via the sync Qdrant client
    (wrapped in async context by the caller when needed).
    """

    def __init__(
        self,
        db_path: str,
        distance_method: str | None = None,
    ):
        self.db_path = db_path
        self.client: QdrantClient | None = None

        if distance_method == DistanceMethod.COSINE:
            self.distance_method = models.Distance.COSINE
        elif distance_method == DistanceMethod.DOT:
            self.distance_method = models.Distance.DOT
        else:
            self.distance_method = models.Distance.COSINE

    def _get_client(self) -> QdrantClient:
        if not self.client:
            raise RuntimeError("QdrantClient is not connected")
        return self.client

    # ── Lifecycle ────────────────────────────────────────────────────────

    async def connect(self) -> None:
        self.client = QdrantClient(path=self.db_path)
        logger.info(f"Qdrant connected at {self.db_path}")

    async def disconnect(self) -> None:
        if self.client:
            self.client.close()
            self.client = None

    # ── Collection management ────────────────────────────────────────────

    async def is_collection_existed(self, collection_name: str) -> bool:
        return self._get_client().collection_exists(collection_name=collection_name)

    async def list_all_collections(self) -> list:
        return [c.name for c in self._get_client().get_collections().collections]

    async def get_collection_info(self, collection_name: str) -> dict | None:
        if not await self.is_collection_existed(collection_name):
            return None
        info = self._get_client().get_collection(collection_name=collection_name)
        return {
            "collection_name": collection_name,
            "vectors_count": getattr(info, "vectors_count", getattr(info, "points_count", 0)),
            "points_count": getattr(info, "points_count", getattr(info, "vectors_count", 0)),
        }

    async def delete_collection(self, collection_name: str) -> bool:
        if await self.is_collection_existed(collection_name):
            self._get_client().delete_collection(collection_name=collection_name)
            logger.info(f"Qdrant collection deleted: {collection_name}")
        return True

    async def create_collection(
        self,
        collection_name: str,
        embedding_size: int,
        do_reset: bool = False,
    ) -> bool:
        if do_reset:
            await self.delete_collection(collection_name)

        if not await self.is_collection_existed(collection_name):
            self._get_client().create_collection(
                collection_name=collection_name,
                vectors_config=models.VectorParams(
                    size=embedding_size,
                    distance=self.distance_method,
                ),
            )
            logger.info(f"Qdrant collection created: {collection_name}")
            return True
        return False

    # ── Insert ───────────────────────────────────────────────────────────

    async def insert_one(
        self,
        collection_name: str,
        text: str,
        vector: list,
        metadata: dict | None = None,
        record_id: str | None = None,
    ) -> bool:
        if not await self.is_collection_existed(collection_name):
            logger.error(f"Qdrant collection does not exist: {collection_name}")
            return False

        try:
            self._get_client().upsert(
                collection_name=collection_name,
                points=[
                    models.PointStruct(
                        id=record_id or 0,
                        vector=vector,
                        payload={"text": text, **(metadata or {})},
                    )
                ],
            )
            return True
        except Exception as e:
            logger.error(f"Qdrant insert_one error: {e}")
            return False

    async def insert_many(
        self,
        collection_name: str,
        texts: list,
        vectors: list,
        metadata: list | None = None,
        record_ids: list | None = None,
        batch_size: int = 50,
    ) -> bool:
        if not await self.is_collection_existed(collection_name):
            logger.error(f"Qdrant collection does not exist: {collection_name}")
            return False

        if not metadata:
            metadata = [None] * len(texts)

        points = [
            models.PointStruct(
                id=(record_ids[i] if record_ids else i),
                vector=vectors[i],
                payload={"text": texts[i], **(metadata[i] or {})},
            )
            for i in range(len(texts))
        ]

        try:
            for i in range(0, len(points), batch_size):
                self._get_client().upsert(
                    collection_name=collection_name,
                    points=points[i : i + batch_size],
                )
            return True
        except Exception as e:
            logger.error(f"Qdrant insert_many error: {e}")
            return False

    # ── Search ───────────────────────────────────────────────────────────

    async def search_by_vector(
        self,
        collection_name: str,
        vector: list,
        limit: int = 5,
    ) -> list[RetrievedDocument]:
        if not await self.is_collection_existed(collection_name):
            logger.error(f"Qdrant collection does not exist: {collection_name}")
            return []

        method_name = "search"
        search_fn: Callable = getattr(self._get_client(), method_name)
        results = search_fn(
            collection_name=collection_name,
            query_vector=vector,
            limit=limit,
        )

        return [
            RetrievedDocument(
                text=r.payload.get("text", ""),
                score=r.score,
            )
            for r in results
        ]
