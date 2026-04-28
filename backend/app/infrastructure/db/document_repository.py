"""
MongoDB repository for uploaded documents.

Documents represent files uploaded by users for RAG / Q&A.
Status lifecycle: processing → ready | failed
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from bson import ObjectId
from loguru import logger

from app.infrastructure.db.mongodb import documents_col

DocumentStatus = Literal["processing", "ready", "failed"]
FileType = Literal["pdf", "txt", "md"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def create_document(
    user_id: str,
    filename: str,
    file_type: FileType,
    vector_collection: str = "",
) -> dict:
    """Insert a new document record with status='processing'."""
    doc = {
        "user_id": ObjectId(user_id),
        "filename": filename,
        "file_type": file_type,
        "upload_date": _now(),
        "chunk_count": 0,
        "vector_collection": vector_collection,
        "status": "processing",
    }
    result = await documents_col().insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    doc["user_id"] = user_id
    logger.debug(f"Document created | id={doc['_id']} | user={user_id} | file={filename}")
    return doc


async def get_document(document_id: str) -> Optional[dict]:
    """Fetch a document by id."""
    try:
        doc = await documents_col().find_one({"_id": ObjectId(document_id)})
    except Exception:
        return None
    return _serialise(doc) if doc else None


async def list_user_documents(
    user_id: str,
    status: Optional[DocumentStatus] = None,
    limit: int = 100,
) -> list[dict]:
    """List documents for a user, optionally filtered by status."""
    query: dict = {"user_id": ObjectId(user_id)}
    if status:
        query["status"] = status

    cursor = documents_col().find(query).sort("upload_date", -1).limit(limit)
    return [_serialise(doc) async for doc in cursor]


async def update_document_status(
    document_id: str,
    status: DocumentStatus,
    chunk_count: int = 0,
    vector_collection: str = "",
) -> Optional[dict]:
    """Update the processing status of a document."""
    update: dict = {"$set": {"status": status}}
    if chunk_count:
        update["$set"]["chunk_count"] = chunk_count
    if vector_collection:
        update["$set"]["vector_collection"] = vector_collection

    result = await documents_col().find_one_and_update(
        {"_id": ObjectId(document_id)},
        update,
        return_document=True,
    )
    return _serialise(result) if result else None


async def delete_document(document_id: str) -> bool:
    """Delete a document record. Returns True if deleted."""
    result = await documents_col().delete_one({"_id": ObjectId(document_id)})
    return result.deleted_count > 0


def _serialise(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "user_id": str(doc["user_id"]),
        "filename": doc.get("filename", ""),
        "file_type": doc.get("file_type", ""),
        "upload_date": doc.get("upload_date"),
        "chunk_count": doc.get("chunk_count", 0),
        "vector_collection": doc.get("vector_collection", ""),
        "status": doc.get("status", "processing"),
    }
