from uuid import UUID

from loguru import logger
from sqlalchemy import select, text
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
                {
                    "event": "retrieval_executed",
                    "retrieved_chunks_count": len(output),
                    "avg_similarity": round(avg_sim, 4),
                    "empty_retrieval_rate": 0.0,
                    "document_id": str(document_id) if document_id else None,
                    "scope": scope,
                    "scope_id": str(scope_id) if scope_id else None,
                }
            )
        else:
            logger.debug(
                {
                    "event": "retrieval_executed",
                    "retrieved_chunks_count": 0,
                    "avg_similarity": 0.0,
                    "empty_retrieval_rate": 1.0,
                    "document_id": str(document_id) if document_id else None,
                    "scope": scope,
                    "scope_id": str(scope_id) if scope_id else None,
                }
            )

        return output
