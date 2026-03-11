"""
RAG domain policies — default configuration for retrieval-augmented generation.

These are stubs for future RAG implementation.
"""

# ── Chunking Defaults ─────────────────────────────────────────────────────────
CHUNK_SIZE = 512  # characters per chunk
CHUNK_OVERLAP = 64  # overlap between adjacent chunks

# ── Retrieval Defaults ────────────────────────────────────────────────────────
TOP_K = 5  # number of chunks to retrieve
SIMILARITY_THRESHOLD = 0.7  # minimum similarity score to include
RERANK_ENABLED = False  # whether to apply cross-encoder reranking

# ── Embedding Defaults ────────────────────────────────────────────────────────
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
EMBEDDING_DIMENSION = 384
