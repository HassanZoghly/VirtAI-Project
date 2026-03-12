"""Tests for RAG domain entities — pure dataclass behavior.

Note: These are stub entities for future RAG implementation.
Tests cover dataclass construction and field defaults.
"""

from app.domain.rag.entities import Citation, DocumentChunk, Source


class TestDocumentChunk:
    def test_creation(self):
        chunk = DocumentChunk(id="c1", text="Hello world", source="doc.pdf")
        assert chunk.id == "c1"
        assert chunk.text == "Hello world"
        assert chunk.source == "doc.pdf"

    def test_defaults(self):
        chunk = DocumentChunk(id="c1", text="t", source="s")
        assert chunk.metadata == {}
        assert chunk.embedding == []
        assert chunk.score == 0.0

    def test_with_embedding(self):
        emb = [0.1, 0.2, 0.3]
        chunk = DocumentChunk(id="c1", text="t", source="s", embedding=emb)
        assert chunk.embedding == emb
        assert len(chunk.embedding) == 3

    def test_with_score(self):
        chunk = DocumentChunk(id="c1", text="t", source="s", score=0.95)
        assert chunk.score == 0.95

    def test_metadata_dict(self):
        meta = {"page": 5, "section": "intro"}
        chunk = DocumentChunk(id="c1", text="t", source="s", metadata=meta)
        assert chunk.metadata["page"] == 5

    def test_separate_instances_get_own_defaults(self):
        c1 = DocumentChunk(id="c1", text="t", source="s")
        c2 = DocumentChunk(id="c2", text="t", source="s")
        c1.metadata["key"] = "val"
        assert "key" not in c2.metadata


class TestCitation:
    def test_creation(self):
        cite = Citation(chunk_id="c1", source="doc.pdf", text_excerpt="hello")
        assert cite.chunk_id == "c1"
        assert cite.source == "doc.pdf"
        assert cite.text_excerpt == "hello"

    def test_default_score(self):
        cite = Citation(chunk_id="c1", source="s", text_excerpt="t")
        assert cite.score == 0.0

    def test_with_score(self):
        cite = Citation(chunk_id="c1", source="s", text_excerpt="t", score=0.88)
        assert cite.score == 0.88


class TestSource:
    def test_creation(self):
        src = Source(id="s1", name="Report", path="/docs/report.pdf")
        assert src.id == "s1"
        assert src.name == "Report"
        assert src.path == "/docs/report.pdf"

    def test_defaults(self):
        src = Source(id="s1", name="n", path="p")
        assert src.doc_type == "text"
        assert src.chunk_count == 0
        assert src.metadata == {}
        assert src.ingested_at is None

    def test_doc_types(self):
        for doc_type in ["text", "pdf", "url"]:
            src = Source(id="s1", name="n", path="p", doc_type=doc_type)
            assert src.doc_type == doc_type

    def test_with_chunk_count(self):
        src = Source(id="s1", name="n", path="p", chunk_count=42)
        assert src.chunk_count == 42

    def test_separate_instances_get_own_metadata(self):
        s1 = Source(id="s1", name="n", path="p")
        s2 = Source(id="s2", name="n", path="p")
        s1.metadata["key"] = "val"
        assert "key" not in s2.metadata
