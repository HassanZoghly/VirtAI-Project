from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.rag.ports import DocumentRepositoryPort
from app.domain.rag.stage_machine import IngestionStage, assert_transition
from app.infrastructure.db.models import Document, DocumentChunk
from app.shared.errors import RAGException
from app.shared.ids import require_uuid


@dataclass
class DomainDocument:
    id: UUID | None
    user_id: UUID
    filename: str
    file_type: str
    upload_date: datetime
    chunk_count: int
    status: str
    current_stage: str
    storage_key: str | None
    progress_pct: int
    processed_chunks: int
    total_chunks: int
    error_message: str | None
    retrieval_scope: str
    scope_id: UUID | None

def _to_domain(doc: Document) -> DomainDocument:
    return DomainDocument(
        id=doc.id,
        user_id=doc.user_id,
        filename=doc.filename,
        file_type=doc.file_type,
        upload_date=doc.upload_date,
        chunk_count=doc.chunk_count,
        status=doc.status,
        current_stage=getattr(doc, "current_stage", "QUEUED"),
        storage_key=getattr(doc, "storage_key", None),
        progress_pct=getattr(doc, "progress_pct", 0),
        processed_chunks=getattr(doc, "processed_chunks", 0),
        total_chunks=getattr(doc, "total_chunks", 0),
        error_message=getattr(doc, "error_message", None),
        retrieval_scope=getattr(doc, "retrieval_scope", "GLOBAL"),
        scope_id=getattr(doc, "scope_id", None),
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)


class DocumentRepository(DocumentRepositoryPort):
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(
        self, user_id: str, filename: str, file_type: str, session_id: str | None = None,
        id: str | None = None, document_sha256: str | None = None, file_size: int = 0, storage_key: str | None = None
    ) -> DomainDocument:

        scope = "SESSION" if session_id else "GLOBAL"
        s_id = require_uuid(session_id, field_name="session_id") if session_id else None
        
        doc_id = require_uuid(id, field_name="id") if id else None

        doc = Document(
            id=doc_id,
            user_id=require_uuid(user_id, field_name="user_id"),
            filename=filename,
            file_type=file_type,
            status="QUEUED",
            current_stage="QUEUED",
            upload_date=_now(),
            retrieval_scope=scope,
            scope_id=s_id,
            document_sha256=document_sha256,
            file_size=file_size,
            storage_key=storage_key,
        )
        self.db.add(doc)
        await self.db.flush()
        await self.db.refresh(doc)
        return _to_domain(doc)

    async def get(self, document_id: str) -> DomainDocument | None:
        stmt = select(Document).where(
            Document.id == require_uuid(document_id, field_name="document_id")
        )
        result = await self.db.execute(stmt)
        doc = result.scalar_one_or_none()
        return _to_domain(doc) if doc else None

    async def list_by_user(
        self,
        user_id: str,
        status: str | None = None,
        limit: int = 100,
        session_id: str | None = None,
    ) -> Sequence[DomainDocument]:
        uid = require_uuid(user_id, field_name="user_id")
        stmt = select(Document).where(Document.user_id == uid)
        if status:
            stmt = stmt.where(Document.status == status)
        if session_id:
            s_id = require_uuid(session_id, field_name="session_id")
            stmt = stmt.where(Document.retrieval_scope == "SESSION", Document.scope_id == s_id)
        else:
            stmt = stmt.where(Document.retrieval_scope == "GLOBAL")

        stmt = stmt.order_by(Document.upload_date.desc()).limit(limit)
        result = await self.db.execute(stmt)
        return [_to_domain(d) for d in result.scalars().all()]

    async def update_status(
        self, document_id: str, status: str, chunk_count: int = 0
    ) -> DomainDocument | None:
        stmt = (
            update(Document)
            .where(Document.id == require_uuid(document_id, field_name="document_id"))
            .values(status=status, chunk_count=chunk_count)
            .returning(Document)
        )
        result = await self.db.execute(stmt)
        await self.db.flush()
        doc = result.scalar_one_or_none()
        return _to_domain(doc) if doc else None

    async def delete(self, document_id: str) -> bool:
        stmt = select(Document).where(
            Document.id == require_uuid(document_id, field_name="document_id")
        )
        result = await self.db.execute(stmt)
        doc = result.scalar_one_or_none()
        if doc:
            await self.db.delete(doc)
            await self.db.flush()
            return True
        return False

    async def update_progress(
        self, document_id: str, stage: str, pct: int, processed: int, total: int
    ) -> None:
        doc_uuid = require_uuid(document_id, field_name="document_id")
        doc = await self.get(document_id)
        if not doc:
            return

        if doc.current_stage != stage:
            assert_transition(IngestionStage(doc.current_stage), IngestionStage(stage))

        stmt = (
            update(Document)
            .where(Document.id == doc_uuid)
            .values(
                current_stage=stage,
                status=stage,
                progress_pct=pct,
                processed_chunks=processed,
                total_chunks=total,
            )
        )
        await self.db.execute(stmt)

    async def find_by_sha256(
        self, user_id: str, sha256: str, session_id: str | None = None
    ) -> Document | None:
        stmt = select(Document).where(
            Document.user_id == require_uuid(user_id, field_name="user_id"),
            Document.document_sha256 == sha256,
        )
        if session_id:
            s_id = require_uuid(session_id, field_name="session_id")
            stmt = stmt.where(Document.retrieval_scope == "SESSION", Document.scope_id == s_id)
        else:
            stmt = stmt.where(Document.retrieval_scope == "GLOBAL")

        result = await self.db.execute(stmt)
        return result.scalars().first()

    async def mark_failed(self, document_id: str, error_msg: str, is_retryable: bool) -> None:
        doc = await self.get(document_id)
        if not doc:
            return

        assert_transition(IngestionStage(doc.current_stage), IngestionStage.FAILED)

        stmt = (
            update(Document)
            .where(Document.id == require_uuid(document_id, field_name="document_id"))
            .values(
                current_stage=IngestionStage.FAILED.value,
                status=IngestionStage.FAILED.value,
                error_message=error_msg,
                retry_count=Document.retry_count + (1 if is_retryable else 0),
            )
        )
        await self.db.execute(stmt)

    async def mark_cancelled(self, document_id: str) -> None:
        doc = await self.get(document_id)
        if not doc:
            return

        assert_transition(IngestionStage(doc.current_stage), IngestionStage.CANCELLED)

        stmt = (
            update(Document)
            .where(Document.id == require_uuid(document_id, field_name="document_id"))
            .values(
                current_stage=IngestionStage.CANCELLED.value,
                status=IngestionStage.CANCELLED.value,
            )
        )
        await self.db.execute(stmt)

    async def get_status(self, document_id: str, user_id: str) -> dict[str, Any] | None:
        stmt = select(Document).where(
            Document.id == require_uuid(document_id, field_name="document_id"),
            Document.user_id == require_uuid(user_id, field_name="user_id"),
        )
        result = await self.db.execute(stmt)
        doc = result.scalar_one_or_none()
        if not doc:
            return None
        return {
            "id": str(doc.id),
            "filename": doc.filename,
            "status": doc.status,
            "current_stage": doc.current_stage,
            "progress_pct": doc.progress_pct,
            "processed_chunks": doc.processed_chunks,
            "total_chunks": doc.total_chunks,
            "started_at": doc.started_at.isoformat() if doc.started_at else None,
            "completed_at": doc.completed_at.isoformat() if doc.completed_at else None,
            "upload_source": doc.upload_source,
            "error_message": doc.error_message,
        }

    async def list_active(self, user_id: str) -> list[Document]:
        terminal = ["COMPLETE", "FAILED", "CANCELLED"]
        stmt = (
            select(Document)
            .where(Document.user_id == require_uuid(user_id, field_name="user_id"))
            .where(Document.current_stage.notin_(terminal))
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def count_active_jobs(self, user_id: str) -> int:
        terminal = ["COMPLETE", "FAILED", "CANCELLED"]
        stmt = (
            select(func.count(Document.id))
            .where(Document.user_id == require_uuid(user_id, field_name="user_id"))
            .where(Document.current_stage.notin_(terminal))
        )
        result = await self.db.execute(stmt)
        return result.scalar_one() or 0

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

    async def delete_with_cascade(self, document_id: str, user_id: str) -> str | None:
        """Deletes a document explicitly. Returns the storage_key to be deleted from storage."""
        stmt = select(Document).where(
            Document.id == require_uuid(document_id, field_name="document_id"),
            Document.user_id == require_uuid(user_id, field_name="user_id")
        )
        result = await self.db.execute(stmt)
        doc = result.scalar_one_or_none()
        if not doc:
            return None
        storage_key = doc.storage_key
        await self.db.delete(doc)
        return storage_key

    async def get_stage(self, document_id: str) -> str | None:
        stmt = select(Document.current_stage).where(
            Document.id == require_uuid(document_id, field_name="document_id")
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def update_content_hash(self, document_id: str, content_hash: str) -> None:
        stmt = update(Document).where(
            Document.id == require_uuid(document_id, field_name="document_id")
        ).values(normalized_content_hash=content_hash)
        await self.db.execute(stmt)

    async def mark_completed(self, document_id: str) -> None:
        stmt = update(Document).where(
            Document.id == require_uuid(document_id, field_name="document_id")
        ).values(completed_at=_now())
        await self.db.execute(stmt)

    async def delete_all_chunks(self, document_id: str) -> None:
        stmt = delete(DocumentChunk).where(
            DocumentChunk.document_id == require_uuid(document_id, field_name="document_id")
        )
        await self.db.execute(stmt)

