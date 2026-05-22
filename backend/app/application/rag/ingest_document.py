import time
from collections.abc import Awaitable, Callable

from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.rag.entities import DocumentChunk
from app.domain.rag.normalization import compute_content_hash, normalize_text
from app.domain.rag.ports import (
    ChunkingStrategy,
    DocumentParser,
    EmbeddingProvider,
)
from app.domain.storage.ports import StorageProvider
from app.infrastructure.db.database import get_db
from app.infrastructure.db.repositories.document_repository import DocumentRepository
from app.infrastructure.vector.pgvector_store import PGVectorStore
from app.shared.config import get_settings
from app.shared.errors import ChunkLimitExceeded, EmptyDocumentError, IngestionCancelledException
from app.shared.ids import require_uuid


async def get_short_session() -> AsyncSession:
    db_gen = get_db()
    return await anext(db_gen)


class IngestDocumentUseCase:
    def __init__(
        self,
        storage: StorageProvider,
        parser: DocumentParser,
        chunker: ChunkingStrategy,
        embedder: EmbeddingProvider,
    ):
        self.storage = storage
        self.parser = parser
        self.chunker = chunker
        self.embedder = embedder
        self.settings = get_settings()

    async def execute(
        self,
        doc_id: str,
        user_id: str,
        filename: str,
        file_type: str,
        storage_key: str,
        progress_callback: Callable[[str, int, int, int], Awaitable[None]],
        cancellation_check: Callable[[], Awaitable[bool]],
        log_ctx: dict,
    ) -> None:
        doc_uuid = require_uuid(doc_id, field_name="document_id")
        require_uuid(user_id, field_name="user_id")
        doc_id = str(doc_uuid)

        # 0. Initial Cleanup (in case of retries)
        async with await get_short_session() as db:
            repo = DocumentRepository(db)
            await repo.delete_inactive_chunks(doc_id)
            doc = await repo.get(doc_id)
            retrieval_scope = doc.retrieval_scope
            scope_id = doc.scope_id

        # 1. UPLOADING
        await progress_callback("UPLOADING", 5, 0, 0)
        file_bytes = await self.storage.get_bytes(storage_key)

        # 2. PARSING
        t_parse = time.monotonic()
        await progress_callback("PARSING", 10, 0, 0)
        raw_text = await self.parser.parse_bytes(file_bytes, file_type)

        normalized = normalize_text(raw_text)
        if len(normalized.strip()) == 0:
            raise EmptyDocumentError("Document parsed to empty text")

        content_hash = compute_content_hash(normalized)

        async with await get_short_session() as db:
            repo = DocumentRepository(db)
            # We don't have an explicit method for hash update, so we update it directly
            from sqlalchemy import update

            from app.infrastructure.db.models import Document

            await db.execute(
                update(Document)
                .where(Document.id == doc_uuid)
                .values(normalized_content_hash=content_hash)
            )
            await db.commit()

        logger.info(
            {
                **log_ctx,
                "event": "stage_complete",
                "stage": "PARSING",
                "duration_ms": int((time.monotonic() - t_parse) * 1000),
            }
        )

        # 3. CHUNKING
        t_chunk = time.monotonic()
        await progress_callback("CHUNKING", 25, 0, 0)
        chunks_text = self.chunker.chunk(normalized)

        total_chunks = len(chunks_text)
        if total_chunks == 0:
            raise EmptyDocumentError("Document chunked to 0 chunks")

        if total_chunks > self.settings.MAX_CHUNKS_PER_DOCUMENT:
            raise ChunkLimitExceeded(
                f"Document exceeds {self.settings.MAX_CHUNKS_PER_DOCUMENT} chunks"
            )

        logger.info(
            {
                **log_ctx,
                "event": "stage_complete",
                "stage": "CHUNKING",
                "duration_ms": int((time.monotonic() - t_chunk) * 1000),
                "total_chunks": total_chunks,
            }
        )

        # 4. EMBEDDING + INDEXING
        t_embed = time.monotonic()
        await progress_callback("EMBEDDING", 50, 0, total_chunks)

        async with await get_short_session() as db:
            repo = DocumentRepository(db)
            next_version = await repo.get_next_chunk_version(doc_id)

        processed = 0
        batch_size = self.settings.EMBEDDING_BATCH_SIZE

        for i in range(0, total_chunks, batch_size):
            if await cancellation_check():
                await self._cleanup_cancelled(doc_id, storage_key)
                raise IngestionCancelledException()

            batch_texts = chunks_text[i : i + batch_size]

            # Embed outside transaction
            embeddings = await self.embedder.embed_batch(batch_texts)

            # Index batch in short transaction
            chunks_to_store = []
            for j, (text, emb) in enumerate(zip(batch_texts, embeddings)):
                chunk = DocumentChunk(
                    id=None,
                    document_id=doc_uuid,
                    chunk_text=text,
                    chunk_order=i + j,
                    embedding=emb,
                    metadata={"source": filename},
                    chunk_version=next_version,
                    is_active=False,  # Shadow indexing
                    retrieval_scope=retrieval_scope,
                    scope_id=scope_id,
                )
                chunks_to_store.append(chunk)

            async with await get_short_session() as db:
                vector_store = PGVectorStore(db)
                await vector_store.store_chunks_batch(chunks_to_store, embeddings)
                await db.commit()

            processed += len(batch_texts)
            progress = 50 + int((processed / total_chunks) * 35)
            await progress_callback("EMBEDDING", progress, processed, total_chunks)

        logger.info(
            {
                **log_ctx,
                "event": "stage_complete",
                "stage": "EMBEDDING",
                "duration_ms": int((time.monotonic() - t_embed) * 1000),
                "throughput_cps": round(total_chunks / (time.monotonic() - t_embed), 2),
            }
        )

        # 5. ATOMIC ACTIVATION
        t_activate = time.monotonic()
        await progress_callback("INDEXING", 90, processed, total_chunks)

        if await cancellation_check():
            await self._cleanup_cancelled(doc_id, storage_key)
            raise IngestionCancelledException()

        async with await get_short_session() as db:
            repo = DocumentRepository(db)
            rows = await repo.activate_chunk_version(doc_id, next_version, total_chunks)
            if rows == 0:
                # Activation aborted (e.g. document was CANCELLED mid-activation)
                await self._cleanup_cancelled(doc_id, storage_key)
                raise IngestionCancelledException()
            await db.commit()

        logger.info(
            {
                **log_ctx,
                "event": "stage_complete",
                "stage": "INDEXING",
                "duration_ms": int((time.monotonic() - t_activate) * 1000),
            }
        )

        # 6. COMPLETE
        async with await get_short_session() as db:
            repo = DocumentRepository(db)
            await repo.delete_inactive_chunks(doc_id, active_version=next_version)
            await repo.update_progress(doc_id, "COMPLETE", 100, total_chunks, total_chunks)
            # Update completed_at
            from sqlalchemy import update

            from app.infrastructure.db.models import Document
            from app.infrastructure.db.repositories.document_repository import _now

            await db.execute(
                update(Document).where(Document.id == doc_uuid).values(completed_at=_now())
            )
            await db.commit()

    async def _cleanup_cancelled(self, doc_id: str, storage_key: str) -> None:
        """Cleans up completely on cancellation (zero retrieval pollution)."""
        async with await get_short_session() as db:
            from sqlalchemy import delete

            from app.infrastructure.db.models import DocumentChunk

            # Delete ALL chunks for this document
            doc_uuid = require_uuid(doc_id, field_name="document_id")
            await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == doc_uuid))
            await db.commit()

        if await self.storage.exists(storage_key):
            await self.storage.delete(storage_key)
