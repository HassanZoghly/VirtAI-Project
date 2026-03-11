"""
RAG domain entities — data classes for retrieval-augmented generation.

These are stubs for future RAG implementation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class DocumentChunk:
    """A chunk of a document stored in the vector store."""

    id: str
    text: str
    source: str  # original document path/URL
    metadata: dict = field(default_factory=dict)
    embedding: list[float] = field(default_factory=list)
    score: float = 0.0  # similarity score (populated during retrieval)


@dataclass
class Citation:
    """A citation linking an answer to its source chunk."""

    chunk_id: str
    source: str
    text_excerpt: str
    score: float = 0.0


@dataclass
class Source:
    """Metadata about an ingested document source."""

    id: str
    name: str
    path: str
    doc_type: str = "text"  # text, pdf, url
    chunk_count: int = 0
    metadata: dict = field(default_factory=dict)
    ingested_at: Optional[str] = None
