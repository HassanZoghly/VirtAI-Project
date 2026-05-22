from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID


@dataclass
class Document:
    id: UUID | None
    user_id: UUID
    filename: str
    file_type: str
    upload_date: datetime
    chunk_count: int
    status: str  # processing, ready, failed


@dataclass
class DocumentChunk:
    id: UUID | None
    document_id: UUID
    chunk_text: str
    chunk_order: int
    embedding: list[float] | None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    chunk_version: int = 1
    is_active: bool = True
    retrieval_scope: str = "GLOBAL"
    scope_id: UUID | None = None
