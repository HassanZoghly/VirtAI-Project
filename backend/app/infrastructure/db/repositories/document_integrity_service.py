from __future__ import annotations

from uuid import UUID

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.db.models import (
    Document, 
    DocumentChunk, 
    SummaryCache, 
    DiagramCache, 
    Quiz
)
from app.shared.errors import RAGException
from app.shared.ids import require_uuid


class DocumentIntegrityService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_next_chunk_version(self, document_id: str) -> int:
        stmt = select(func.max(DocumentChunk.chunk_version)).where(
            DocumentChunk.document_id == require_uuid(document_id, field_name="document_id")
        )
        result = await self.db.execute(stmt)
        max_version = result.scalar_one_or_none()
        return (max_version or 0) + 1

    async def _validate_chunk_integrity(
        self, doc_id: UUID, version: int, expected_total: int
    ) -> None:
        result = await self.db.execute(
            text("""
                SELECT
                    COUNT(*)                                          AS chunk_count,
                    COUNT(*) FILTER (WHERE embedding IS NOT NULL)     AS embedded_count,
                    MIN(chunk_order)                                  AS min_order,
                    MAX(chunk_order)                                  AS max_order
                FROM document_chunks
                WHERE document_id = :doc_id
                  AND chunk_version = :version
                  AND is_active = FALSE
            """),
            {"doc_id": doc_id, "version": version},
        )
        row = result.one()
        if row.chunk_count != expected_total:
            raise RAGException(f"Count mismatch: {row.chunk_count} != {expected_total}")
        if row.embedded_count != expected_total:
            raise RAGException(f"Embedding gap: {row.embedded_count} != {expected_total}")
        if row.min_order != 0 or row.max_order != expected_total - 1:
            raise RAGException(
                f"Order gap: [{row.min_order}..{row.max_order}] for {expected_total} chunks"
            )

    async def activate_chunk_version(
        self, document_id: str, new_version: int, expected_total: int
    ) -> int:
        doc_uuid = require_uuid(document_id, field_name="document_id")
        # 1. Integrity check
        await self._validate_chunk_integrity(doc_uuid, new_version, expected_total)

        # 2. Atomic activation with row lock
        # Ensures that activation is aborted if the document has been CANCELLED
        lock_stmt = (
            select(Document.id)
            .where(Document.id == doc_uuid, Document.current_stage != "CANCELLED")
            .with_for_update()
        )

        lock_result = await self.db.execute(lock_stmt)
        if not lock_result.scalar_one_or_none():
            return 0  # Document is CANCELLED or missing

        stmt = text("""
            UPDATE document_chunks
            SET is_active = (chunk_version = :new_version)
            WHERE document_id = :doc_id
        """)
        result = await self.db.execute(stmt, {"doc_id": doc_uuid, "new_version": new_version})
        
        # Clear derived caches since document content was updated
        await self.db.execute(delete(SummaryCache).where(SummaryCache.document_id == doc_uuid))
        await self.db.execute(delete(DiagramCache).where(DiagramCache.document_id == doc_uuid))
        await self.db.execute(delete(Quiz).where(Quiz.document_id == doc_uuid))

        from typing import cast

        from sqlalchemy import CursorResult
        return cast("CursorResult", result).rowcount

    async def delete_inactive_chunks(
        self, document_id: str, active_version: int | None = None
    ) -> None:
        """
        Safe inactive cleanup. If active_version is specified, only deletes versions strictly
        less than the active version (prevents accidental deletion of a newer inactive version
        that's currently being built).
        """
        doc_uuid = require_uuid(document_id, field_name="document_id")
        stmt = delete(DocumentChunk).where(
            DocumentChunk.document_id == doc_uuid,
            DocumentChunk.is_active.is_(False),
        )
        if active_version is not None:
            stmt = stmt.where(DocumentChunk.chunk_version < active_version)

        await self.db.execute(stmt)

    async def delete_all_chunks(self, document_id: str) -> None:
        stmt = delete(DocumentChunk).where(
            DocumentChunk.document_id == require_uuid(document_id, field_name="document_id")
        )
        await self.db.execute(stmt)

    async def delete_chunks_by_version(self, document_id: str, version: int) -> None:
        stmt = delete(DocumentChunk).where(
            DocumentChunk.document_id == require_uuid(document_id, field_name="document_id"),
            DocumentChunk.chunk_version == version
        )
        await self.db.execute(stmt)

    async def has_any_chunks(self, document_id: str) -> bool:
        stmt = select(func.count(DocumentChunk.id)).where(
            DocumentChunk.document_id == require_uuid(document_id, field_name="document_id")
        )
        result = await self.db.execute(stmt)
        return (result.scalar_one() or 0) > 0
