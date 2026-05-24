from uuid import UUID

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.rag.entities import DocumentChunk
from app.domain.rag.ports import VectorStore
from app.infrastructure.db.models import DocumentChunk as ChunkModel
from app.shared.config import get_settings
from app.shared.errors import VectorDimensionMismatch

settings = get_settings()


class PGVectorStore(VectorStore):
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    async def store_chunks_batch(
        self, chunks: list[DocumentChunk], embeddings: list[list[float]]
    ) -> None:
        if not chunks:
            return

        expected = settings.EMBEDDING_DIMENSION
        for emb in embeddings:
            if len(emb) != expected:
                raise VectorDimensionMismatch(expected=expected, actual=len(emb))

        models = [
            ChunkModel(
                id=chunk.id,
                document_id=chunk.document_id,
                chunk_text=chunk.chunk_text,
                chunk_order=chunk.chunk_order,
                embedding=emb,
                chunk_metadata=chunk.metadata,
                chunk_version=chunk.chunk_version,
                is_active=chunk.is_active,
                retrieval_scope=chunk.retrieval_scope,
                scope_id=chunk.scope_id,
            )
            for chunk, emb in zip(chunks, embeddings)
        ]
        self.db.add_all(models)
        await self.db.flush()

    async def search(
        self,
        query_vector: list[float],
        limit: int = 5,
        document_id: UUID | None = None,
        scope: str | None = None,
        scope_id: UUID | None = None,
    ) -> list[tuple[DocumentChunk, float]]:
        stmt = (
            select(
                ChunkModel,
                (1 - ChunkModel.embedding.cosine_distance(query_vector)).label("similarity"),
            )
            .where(ChunkModel.is_active == True)
            .order_by(ChunkModel.embedding.cosine_distance(query_vector))
            .limit(limit)
        )

        if document_id:
            stmt = stmt.where(ChunkModel.document_id == document_id)

        if scope:
            stmt = stmt.where(ChunkModel.retrieval_scope == scope)
            if scope_id:
                stmt = stmt.where(ChunkModel.scope_id == scope_id)
            else:
                stmt = stmt.where(ChunkModel.scope_id.is_(None))

        result = await self.db.execute(stmt)
        rows = result.all()
        output = []
        for row in rows:
            model = row[0]
            similarity = row[1]
            chunk = DocumentChunk(
                id=model.id,
                document_id=model.document_id,
                chunk_text=model.chunk_text,
                chunk_order=model.chunk_order,
                embedding=model.embedding,
                metadata=model.chunk_metadata,
                created_at=model.created_at,
                chunk_version=model.chunk_version,
                is_active=model.is_active,
                retrieval_scope=model.retrieval_scope,
                scope_id=model.scope_id,
            )
            output.append((chunk, float(similarity)))

        # Retrieval instrumentation
        if output:
            avg_sim = sum(sim for _, sim in output) / len(output)
            logger.debug(
                f"[VectorStore] Dense search found {len(output)} chunks | avg_sim={avg_sim:.3f}"
            )
        else:
            logger.debug("[VectorStore] Dense search found 0 chunks")

        return output

    async def hybrid_search(
        self,
        query_text: str,
        query_vector: list[float],
        limit: int = 10,
        document_id: UUID | None = None,
        scope: str | None = None,
        scope_id: UUID | None = None,
    ) -> list[tuple[DocumentChunk, float]]:
        dense_similarity = 1 - ChunkModel.embedding.cosine_distance(query_vector)
        text_query = func.websearch_to_tsquery("english", query_text)
        text_vector = func.to_tsvector("english", ChunkModel.chunk_text)
        text_rank = func.ts_rank(text_vector, text_query)

        final_score = dense_similarity * 0.7 + text_rank * 0.3

        stmt = (
            select(
                ChunkModel,
                final_score.label("hybrid_score"),
            )
            .where(ChunkModel.is_active == True)
            .order_by(final_score.desc())
            .limit(limit)
        )

        if document_id:
            stmt = stmt.where(ChunkModel.document_id == document_id)

        if scope:
            stmt = stmt.where(ChunkModel.retrieval_scope == scope)
            if scope_id:
                stmt = stmt.where(ChunkModel.scope_id == scope_id)
            else:
                stmt = stmt.where(ChunkModel.scope_id.is_(None))

        result = await self.db.execute(stmt)
        rows = result.all()
        output = []
        for row in rows:
            model = row[0]
            hybrid_score = row[1]
            chunk = DocumentChunk(
                id=model.id,
                document_id=model.document_id,
                chunk_text=model.chunk_text,
                chunk_order=model.chunk_order,
                embedding=model.embedding,
                metadata=model.chunk_metadata,
                created_at=model.created_at,
                chunk_version=model.chunk_version,
                is_active=model.is_active,
                retrieval_scope=model.retrieval_scope,
                scope_id=model.scope_id,
            )
            output.append((chunk, float(hybrid_score)))

        if output:
            avg_score = sum(score for _, score in output) / len(output)
            logger.debug(
                f"[VectorStore] Hybrid search found {len(output)} chunks | avg_score={avg_score:.3f}"
            )
        else:
            logger.debug("[VectorStore] Hybrid search found 0 chunks")

        return output


class SessionManagedPGVectorStore(VectorStore):
    """
    A VectorStore adapter that manages its own database session.
    Ideal for injection into long-lived application services.
    """

    async def store_chunks_batch(
        self, chunks: list[DocumentChunk], embeddings: list[list[float]]
    ) -> None:
        from app.infrastructure.db.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            store = PGVectorStore(db)
            await store.store_chunks_batch(chunks, embeddings)
            await db.commit()

    async def search(
        self,
        query_vector: list[float],
        limit: int = 5,
        document_id: UUID | None = None,
        scope: str | None = None,
        scope_id: UUID | None = None,
    ) -> list[tuple[DocumentChunk, float]]:
        from app.infrastructure.db.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            store = PGVectorStore(db)
            return await store.search(query_vector, limit, document_id, scope, scope_id)

    async def hybrid_search(
        self,
        query_text: str,
        query_vector: list[float],
        limit: int = 10,
        document_id: UUID | None = None,
        scope: str | None = None,
        scope_id: UUID | None = None,
    ) -> list[tuple[DocumentChunk, float]]:
        from app.infrastructure.db.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            store = PGVectorStore(db)
            return await store.hybrid_search(
                query_text, query_vector, limit, document_id, scope, scope_id
            )
