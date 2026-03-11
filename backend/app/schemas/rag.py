"""
RAG (Retrieval-Augmented Generation) request / response DTOs.

Stub module — will be populated when RAG endpoints are implemented.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class RAGQuery(BaseModel):
    """Client sends a query to the RAG pipeline."""

    query: str = Field(..., min_length=1, max_length=2000, description="Natural language query")
    top_k: int = Field(5, ge=1, le=20, description="Number of chunks to retrieve")
    session_id: Optional[str] = Field(None, description="Session UUID for context continuity")


class RAGChunk(BaseModel):
    """Single retrieved document chunk."""

    text: str = Field(..., description="Chunk text content")
    source: str = Field(..., description="Source document identifier")
    score: float = Field(..., ge=0.0, le=1.0, description="Relevance score")
    metadata: dict = Field(default_factory=dict, description="Additional metadata")


class RAGResponse(BaseModel):
    """Server returns retrieved chunks (before LLM synthesis)."""

    query: str = Field(..., description="Original query")
    chunks: list[RAGChunk] = Field(default_factory=list, description="Retrieved chunks")
    answer: Optional[str] = Field(None, description="LLM-synthesised answer (if requested)")
