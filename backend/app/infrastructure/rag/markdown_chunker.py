from langchain_text_splitters import MarkdownTextSplitter

from app.domain.rag.ports import ChunkingStrategy


class MarkdownChunker(ChunkingStrategy):
    """Chunking strategy that respects Markdown boundaries and paragraph limits."""

    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 200):
        self.splitter = MarkdownTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )

    def chunk(self, text: str) -> list[str]:
        if not text or not text.strip():
            return []
        chunks = self.splitter.split_text(text)
        return [chunk.strip() for chunk in chunks if chunk.strip()]
