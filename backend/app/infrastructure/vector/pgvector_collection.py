"""
PGVector dynamic-collection provider for the agentic RAG pipeline.

This creates and manages per-project vector tables (e.g. ``collection_384_1``)
using raw SQL + pgvector extension. It coexists with ``pgvector_store.py``
which manages the single ``document_chunks`` table for the ingestion pipeline.

The two strategies will be unified in a future phase.
"""

from __future__ import annotations

import json

from loguru import logger
from sqlalchemy.sql import text as sql_text

from app.domain.rag.ports import VectorCollectionStore
from app.infrastructure.vector.enums import (
    DistanceMethod,
    PgVectorColumn,
    PgVectorDistanceOps,
    PgVectorIndexType,
)


class RetrievedDocument:
    """Lightweight result object from vector search."""

    __slots__ = ("text", "score", "metadata", "id")

    def __init__(
        self,
        text: str,
        score: float,
        metadata: dict | None = None,
        id: str | None = None,
    ):
        self.text = text
        self.score = score
        self.metadata = metadata or {}
        self.id = id

    def dict(self) -> dict:
        return {
            "text": self.text,
            "score": self.score,
            "metadata": self.metadata,
            "id": self.id,
        }


class PGVectorCollectionProvider(VectorCollectionStore):
    """
    Manages dynamic per-project vector collections in PostgreSQL via pgvector.

    Each collection is a separate table named ``collection_{dim}_{project_id}``.
    Indexes are auto-created after ``index_threshold`` records are inserted.
    """

    def __init__(
        self,
        db_client,
        default_vector_size: int = 786,
        distance_method: str | None = None,
        index_threshold: int = 100,
    ):
        self.db_client = db_client
        self.default_vector_size = default_vector_size
        self.index_threshold = index_threshold

        # Map user-friendly distance name to pgvector operator class
        if distance_method == DistanceMethod.COSINE:
            self.distance_method = PgVectorDistanceOps.COSINE.value
        elif distance_method == DistanceMethod.DOT:
            self.distance_method = PgVectorDistanceOps.DOT.value
        else:
            self.distance_method = PgVectorDistanceOps.COSINE.value

        self._table_prefix = PgVectorColumn.PREFIX.value

    # ── Helpers ──────────────────────────────────────────────────────────

    def _index_name(self, collection_name: str) -> str:
        return f"{collection_name}_vector_idx"

    @staticmethod
    def _vector_literal(vector: list) -> str:
        """Format a Python list as a pgvector literal string."""
        return "[" + ",".join(str(v) for v in vector) + "]"

    # ── Lifecycle ────────────────────────────────────────────────────────

    async def connect(self) -> None:
        async with self.db_client() as session:
            async with session.begin():
                await session.execute(sql_text("CREATE EXTENSION IF NOT EXISTS vector"))
                await session.commit()

    async def disconnect(self) -> None:
        pass  # Connection pooling handled by SQLAlchemy engine

    # ── Collection management ────────────────────────────────────────────

    async def is_collection_existed(self, collection_name: str) -> bool:
        async with self.db_client() as session:
            async with session.begin():
                stmt = sql_text(
                    "SELECT 1 FROM pg_tables WHERE tablename = :name"
                )
                result = await session.execute(stmt, {"name": collection_name})
                return result.scalar_one_or_none() is not None

    async def list_all_collections(self) -> list:
        async with self.db_client() as session:
            async with session.begin():
                stmt = sql_text(
                    "SELECT tablename FROM pg_tables WHERE tablename LIKE :prefix"
                )
                result = await session.execute(
                    stmt, {"prefix": f"{self._table_prefix}%"}
                )
                return result.scalars().all()

    async def get_collection_info(self, collection_name: str) -> dict | None:
        async with self.db_client() as session:
            async with session.begin():
                info_stmt = sql_text(
                    "SELECT schemaname, tablename, tableowner, tablespace, hasindexes "
                    "FROM pg_tables WHERE tablename = :name"
                )
                count_stmt = sql_text(f"SELECT COUNT(*) FROM {collection_name}")

                info_result = await session.execute(info_stmt, {"name": collection_name})
                table_data = info_result.fetchone()
                if not table_data:
                    return None

                count_result = await session.execute(count_stmt)
                return {
                    "table_info": {
                        "schemaname": table_data[0],
                        "tablename": table_data[1],
                        "tableowner": table_data[2],
                        "tablespace": table_data[3],
                        "hasindexes": table_data[4],
                    },
                    "record_count": count_result.scalar_one(),
                }

    async def delete_collection(self, collection_name: str) -> bool:
        async with self.db_client() as session:
            async with session.begin():
                logger.info(f"Dropping collection table: {collection_name}")
                await session.execute(
                    sql_text(f"DROP TABLE IF EXISTS {collection_name}")
                )
                await session.commit()
        return True

    async def create_collection(
        self,
        collection_name: str,
        embedding_size: int,
        do_reset: bool = False,
    ) -> bool:
        if do_reset:
            await self.delete_collection(collection_name)

        if await self.is_collection_existed(collection_name):
            return False

        logger.info(f"Creating collection table: {collection_name}")
        col = PgVectorColumn
        async with self.db_client() as session:
            async with session.begin():
                create_sql = sql_text(
                    f"CREATE TABLE {collection_name} ("
                    f"  {col.ID.value} bigserial PRIMARY KEY,"
                    f"  {col.TEXT.value} text,"
                    f"  {col.VECTOR.value} vector({embedding_size}),"
                    f"  {col.METADATA.value} jsonb DEFAULT '{{}}',"
                    f"  {col.CHUNK_ID.value} integer"
                    f")"
                )
                await session.execute(create_sql)
                await session.commit()
        return True

    # ── Index management ─────────────────────────────────────────────────

    async def _is_index_existed(self, collection_name: str) -> bool:
        idx_name = self._index_name(collection_name)
        async with self.db_client() as session:
            async with session.begin():
                stmt = sql_text(
                    "SELECT 1 FROM pg_indexes "
                    "WHERE tablename = :tbl AND indexname = :idx"
                )
                result = await session.execute(
                    stmt, {"tbl": collection_name, "idx": idx_name}
                )
                return bool(result.scalar_one_or_none())

    async def _create_vector_index(
        self,
        collection_name: str,
        index_type: str = PgVectorIndexType.HNSW.value,
    ) -> bool:
        """Auto-create HNSW/IVFFlat index if record count exceeds threshold."""
        if await self._is_index_existed(collection_name):
            return False

        async with self.db_client() as session:
            async with session.begin():
                count = await session.execute(
                    sql_text(f"SELECT COUNT(*) FROM {collection_name}")
                )
                if count.scalar_one() < self.index_threshold:
                    return False

                idx_name = self._index_name(collection_name)
                vec_col = PgVectorColumn.VECTOR.value
                logger.info(f"Creating {index_type} index on {collection_name}")

                await session.execute(
                    sql_text(
                        f"CREATE INDEX {idx_name} ON {collection_name} "
                        f"USING {index_type} ({vec_col} {self.distance_method})"
                    )
                )
        return True

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
            logger.error(f"Collection does not exist: {collection_name}")
            return False

        if not record_id:
            logger.error(f"record_id (chunk_id) required for insert into {collection_name}")
            return False

        col = PgVectorColumn
        async with self.db_client() as session:
            async with session.begin():
                stmt = sql_text(
                    f"INSERT INTO {collection_name} "
                    f"({col.TEXT.value}, {col.VECTOR.value}, {col.METADATA.value}, {col.CHUNK_ID.value}) "
                    f"VALUES (:text, :vector, :metadata, :chunk_id)"
                )
                await session.execute(stmt, {
                    "text": text,
                    "vector": self._vector_literal(vector),
                    "metadata": json.dumps(metadata or {}, ensure_ascii=False),
                    "chunk_id": record_id,
                })
                await session.commit()

        await self._create_vector_index(collection_name)
        return True

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
            logger.error(f"Collection does not exist: {collection_name}")
            return False

        if record_ids and len(vectors) != len(record_ids):
            logger.error(f"vectors/record_ids length mismatch for {collection_name}")
            return False

        if not metadata:
            metadata = [None] * len(texts)

        col = PgVectorColumn
        async with self.db_client() as session:
            async with session.begin():
                for i in range(0, len(texts), batch_size):
                    batch = list(zip(
                        texts[i:i + batch_size],
                        vectors[i:i + batch_size],
                        metadata[i:i + batch_size],
                        (record_ids or [None] * len(texts))[i:i + batch_size],
                    ))

                    values = [
                        {
                            "text": t,
                            "vector": self._vector_literal(v),
                            "metadata": json.dumps(m or {}, ensure_ascii=False),
                            "chunk_id": rid,
                        }
                        for t, v, m, rid in batch
                    ]

                    stmt = sql_text(
                        f"INSERT INTO {collection_name} "
                        f"({col.TEXT.value}, {col.VECTOR.value}, {col.METADATA.value}, {col.CHUNK_ID.value}) "
                        f"VALUES (:text, :vector, :metadata, :chunk_id)"
                    )
                    await session.execute(stmt, values)

        await self._create_vector_index(collection_name)
        return True

    # ── Search ───────────────────────────────────────────────────────────

    async def search_by_vector(
        self,
        collection_name: str,
        vector: list,
        limit: int = 5,
    ) -> list[RetrievedDocument]:
        if not await self.is_collection_existed(collection_name):
            logger.error(f"Collection does not exist: {collection_name}")
            return []

        vec_literal = self._vector_literal(vector)
        col = PgVectorColumn

        async with self.db_client() as session:
            async with session.begin():
                stmt = sql_text(
                    f"SELECT {col.TEXT.value} AS text, "
                    f"  1 - ({col.VECTOR.value} <=> :vector) AS score "
                    f"FROM {collection_name} "
                    f"ORDER BY score DESC "
                    f"LIMIT :limit"
                )
                result = await session.execute(stmt, {"vector": vec_literal, "limit": limit})
                rows = result.fetchall()

        return [
            RetrievedDocument(text=row.text, score=row.score)
            for row in rows
        ]
