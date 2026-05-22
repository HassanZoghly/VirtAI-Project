import hashlib
import re
from typing import Any
import filetype

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.rag.stage_machine import IngestionStage
from app.domain.user.entities import UserEntity
from app.infrastructure.db.database import get_db
from app.infrastructure.db.repositories.document_repository import DocumentRepository
from app.presentation.http.v1.dependencies import StorageDep
from app.presentation.http.v1.endpoints.auth import _current_user
from app.shared.config import get_settings
from app.shared.ids import parse_uuid

router = APIRouter()
settings = get_settings()

def sanitize_filename(filename: str) -> str:
    """Strip path traversal sequences and special characters."""
    if not filename:
        return "unnamed_document"
    # Replace anything that isn't alphanumeric, dot, dash, or underscore
    safe = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', filename)
    # Strip any leading dots to prevent hidden files/traversal
    safe = safe.lstrip('.')
    return safe or "unnamed_document"

ALLOWED_MIME_TYPES = {
    "pdf": {"application/pdf", "application/x-pdf", "application/octet-stream"},
    "txt": {"text/plain", "application/octet-stream"},
    "md": {"text/markdown", "text/plain", "application/octet-stream"},
}


def validate_declared_mime(content_type: str | None, declared_ext: str) -> None:
    if not content_type:
        return
    normalized = content_type.split(";", 1)[0].strip().lower()
    allowed = ALLOWED_MIME_TYPES.get(declared_ext, set())
    if normalized and normalized not in allowed:
        raise HTTPException(
            status_code=415,
            detail="Unsupported file content type. Upload a PDF, TXT, or MD file.",
        )


async def validate_file_magic(data: bytes, declared_ext: str) -> None:
    kind = filetype.guess(data)
    if declared_ext == "pdf":
        if kind is None or kind.extension != "pdf":
            raise HTTPException(
                status_code=400, detail="File content does not match declared type 'pdf'"
            )
    elif declared_ext in ("txt", "md"):
        # For plain text/markdown, filetype might not match a known binary format,
        # but if it matches a KNOWN binary format, it's definitely not pure text.
        if kind is not None:
            raise HTTPException(
                status_code=400, detail=f"File appears to be {kind.mime}, not text/markdown"
            )
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="File is not valid UTF-8") from None


@router.post("/upload", status_code=202)
async def upload_document(
    request: Request,
    storage: StorageDep,
    response: Response,
    file: UploadFile = File(...),
    user: UserEntity = Depends(_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Upload a document and trigger the RAG ingestion pipeline asynchronously."""
    # 1. Validate file type & size early
    safe_filename = sanitize_filename(file.filename)
    ext = safe_filename.split(".")[-1].lower() if "." in safe_filename else ""
    if ext not in ["pdf", "txt", "md"]:
        raise HTTPException(
            status_code=400, detail="Unsupported file type. Must be pdf, txt, or md."
        )

    max_upload_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if file.size and file.size > max_upload_bytes:
        raise HTTPException(
            status_code=413, detail=f"File exceeds maximum size of {settings.MAX_UPLOAD_SIZE_MB}MB"
        )
    validate_declared_mime(file.content_type, ext)

    repo = DocumentRepository(db)

    # 2. Check per-user active job count
    active_jobs = await repo.count_active_jobs(str(user.id))
    if active_jobs >= settings.MAX_ACTIVE_JOBS_PER_USER:
        raise HTTPException(
            status_code=429,
            detail="Too many active ingestion jobs. Please wait for them to finish.",
        )

    # 3. Read file bytes with chunked size limits to prevent memory exhaustion
    file_bytes_array = bytearray()
    while True:
        chunk = await file.read(65536)  # 64KB chunks
        if not chunk:
            break
        file_bytes_array.extend(chunk)
        if len(file_bytes_array) > max_upload_bytes:
            raise HTTPException(
                status_code=413, detail=f"File exceeds maximum size of {settings.MAX_UPLOAD_SIZE_MB}MB"
            )
            
    file_bytes = bytes(file_bytes_array)
    if not file_bytes:
        raise HTTPException(status_code=400, detail="File is empty")
        
    await validate_file_magic(file_bytes, ext)

    # 4. Compute sha256
    file_sha256 = hashlib.sha256(file_bytes).hexdigest()

    # 5. Check dedup
    existing = await repo.find_by_sha256(str(user.id), file_sha256)
    if existing:
        if existing.current_stage == IngestionStage.COMPLETE:
            response.status_code = 200
            return {
                "id": str(existing.id),
                "status": "COMPLETE",
                "message": "Document already ingested",
            }
        if existing.current_stage in {
            IngestionStage.QUEUED,
            IngestionStage.UPLOADING,
            IngestionStage.PARSING,
            IngestionStage.CHUNKING,
            IngestionStage.EMBEDDING,
            IngestionStage.INDEXING,
        }:
            response.status_code = 202
            return {
                "id": str(existing.id),
                "status": existing.current_stage,
                "message": "Document currently processing",
            }
        if existing.current_stage == IngestionStage.FAILED:
            if existing.retry_count < settings.ARQ_MAX_TRIES:
                arq_pool = request.app.state.arq_pool
                await arq_pool.enqueue_job(
                    "run_ingestion_task",
                    _queue_name="ingestion",
                    doc_id=str(existing.id),
                    user_id=str(user.id),
                    filename=existing.filename,
                    file_type=existing.file_type,
                    upload_source=existing.upload_source,
                    storage_key=existing.storage_key,
                )
                response.status_code = 202
                return {
                    "id": str(existing.id),
                    "status": "QUEUED",
                    "message": "Retrying failed document",
                }
            # Max retries exhausted, allow fresh upload below

    # 6. Create DB record (QUEUED) FIRST
    doc = await repo.create(user_id=str(user.id), filename=safe_filename, file_type=ext)

    # Update with SHA256 and size
    from sqlalchemy import update

    from app.infrastructure.db.models import Document

    await db.execute(
        update(Document)
        .where(Document.id == doc.id)
        .values(
            document_sha256=file_sha256,
            file_size=len(file_bytes),
            storage_key=f"{user.id}/{doc.id}.{ext}",
        )
    )
    await db.commit()

    # 7. Write to storage
    storage_key = f"{user.id}/{doc.id}.{ext}"
    try:
        await storage.save(storage_key, file_bytes)
    except Exception as e:
        logger.error(f"Storage failed for {doc.id}: {e}")
        await repo.mark_failed(str(doc.id), f"Storage error: {e!s}", is_retryable=False)
        await db.commit()
        raise HTTPException(status_code=500, detail="Internal server error saving file") from e

    # 8. Enqueue to ARQ
    arq_pool = request.app.state.arq_pool
    try:
        job = await arq_pool.enqueue_job(
            "run_ingestion_task",
            _queue_name="ingestion",
            doc_id=str(doc.id),
            user_id=str(user.id),
            filename=safe_filename,
            file_type=ext,
            upload_source="SETUP",
            storage_key=storage_key,
        )
        if not job:
            raise RuntimeError("Job enqueue returned None")
    except Exception as e:
        logger.error(f"Failed to enqueue job for {doc.id}: {e}")
        await repo.mark_failed(str(doc.id), f"Queue error: {e!s}", is_retryable=False)
        await db.commit()
        await storage.delete(storage_key)
        raise HTTPException(status_code=500, detail="Internal server error enqueueing job") from e

    return {"id": str(doc.id), "status": "QUEUED", "message": "Document ingestion started"}


@router.get("/status", response_model=list[dict[str, Any]])
async def list_statuses(
    active_only: bool = False,
    user: UserEntity = Depends(_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """List statuses for all documents."""
    from app.infrastructure.cache.redis_client import get_redis_or_none
    
    repo = DocumentRepository(db)
    if active_only:
        docs = await repo.list_active(str(user.id))
    else:
        docs = await repo.list_by_user(str(user.id))

    redis_client = get_redis_or_none()
    
    results = []
    for d in docs:
        progress_pct = d.progress_pct
        if redis_client and d.current_stage not in {"COMPLETE", "FAILED", "CANCELLED"}:
            cached_pct = await redis_client.get(f"doc_progress:{d.id}")
            if cached_pct is not None:
                try:
                    progress_pct = int(cached_pct.decode())
                except ValueError:
                    pass
                    
        results.append({
            "id": str(d.id),
            "filename": d.filename,
            "status": d.status,
            "current_stage": d.current_stage,
            "progress_pct": progress_pct,
            "processed_chunks": d.processed_chunks,
            "total_chunks": d.total_chunks,
            "error_message": d.error_message,
        })
        
    return results


@router.get("/{document_id}/status", response_model=dict[str, Any])
async def get_document_status(
    document_id: str,
    user: UserEntity = Depends(_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Get status of a specific document."""
    from app.infrastructure.cache.redis_client import get_redis_or_none
    
    if parse_uuid(document_id) is None:
        raise HTTPException(status_code=400, detail="Invalid document_id")
    repo = DocumentRepository(db)
    status = await repo.get_status(document_id, str(user.id))
    if not status:
        raise HTTPException(status_code=404, detail="Document not found")
        
    redis_client = get_redis_or_none()
    if redis_client and status["current_stage"] not in {"COMPLETE", "FAILED", "CANCELLED"}:
        cached_pct = await redis_client.get(f"doc_progress:{document_id}")
        if cached_pct is not None:
            try:
                status["progress_pct"] = int(cached_pct.decode())
            except ValueError:
                pass
                
    return status


@router.post("/{document_id}/cancel", status_code=200)
async def cancel_document(
    document_id: str,
    user: UserEntity = Depends(_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Cancel document ingestion."""
    if parse_uuid(document_id) is None:
        raise HTTPException(status_code=400, detail="Invalid document_id")
    repo = DocumentRepository(db)
    status = await repo.get_status(document_id, str(user.id))
    if not status:
        raise HTTPException(status_code=404, detail="Document not found")

    stage = status["current_stage"]
    if stage in {IngestionStage.COMPLETE, IngestionStage.FAILED, IngestionStage.CANCELLED}:
        raise HTTPException(status_code=400, detail=f"Cannot cancel document in stage {stage}")

    await repo.mark_cancelled(document_id)
    await db.commit()

    return {"status": "CANCELLED"}


@router.get("/", response_model=list[dict[str, Any]])
async def list_documents(
    user: UserEntity = Depends(_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """List all documents for the current user."""
    repo = DocumentRepository(db)
    docs = await repo.list_by_user(str(user.id))
    return [
        {
            "id": str(d.id),
            "filename": d.filename,
            "status": d.status,
            "current_stage": d.current_stage,
            "upload_date": d.upload_date.isoformat(),
            "chunk_count": d.chunk_count,
            "file_type": d.file_type,
        }
        for d in docs
    ]


@router.delete("/{document_id}", status_code=204)
async def delete_document(
    document_id: str,
    storage: StorageDep,
    user: UserEntity = Depends(_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete a document and cascade delete its chunks."""
    if parse_uuid(document_id) is None:
        raise HTTPException(status_code=400, detail="Invalid document_id")
    repo = DocumentRepository(db)
    storage_key = await repo.delete_with_cascade(document_id, str(user.id))
    if not storage_key:
        raise HTTPException(status_code=404, detail="Document not found")

    await db.commit()

    if storage_key and await storage.exists(storage_key):
        await storage.delete(storage_key)
