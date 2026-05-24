"""
Markdown-aware smart chunker for the agentic RAG pipeline.

Extracted from RAG_project's ProcessController — this module handles
ONLY the text→chunks conversion with awareness of:
- Code blocks (never split mid-block)
- Markdown tables (never split mid-table)
- Headings (used as chunk boundaries)
- Lists (grouped together)
- Overlap via block-level carry-forward (not naive character overlap)

This is a higher-fidelity chunker than the existing ``markdown_chunker.py``
which uses simple ``RecursiveCharacterTextSplitter``. The existing chunker
is still used by the ingestion pipeline; this one will serve the agentic
RAG pipeline for re-processing uploaded documents.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from loguru import logger

try:
    from langchain_text_splitters import RecursiveCharacterTextSplitter
except ImportError:
    RecursiveCharacterTextSplitter = None
    logger.warning("langchain text_splitter not installed — SmartChunker unavailable")


@dataclass
class ChunkedDocument:
    """A single chunk of text with metadata."""

    page_content: str
    metadata: dict = field(default_factory=dict)


class SmartChunker:
    """
    Markdown-aware chunker that respects document structure.

    Processes input text through:
    1. Markdown block extraction (headings, code, tables, lists, paragraphs)
    2. Structure-aware chunk assembly (never splits protected blocks)
    3. Overlap via block carry-forward (not character-level)

    Usage::

        chunker = SmartChunker(chunk_size=1000, overlap_size=200)
        chunks = chunker.chunk_pages(pages)  # list[ExtractedPage] → list[ChunkedDocument]
    """

    # Markdown-aware separators (ordered by priority)
    SEPARATORS = [
        "\n```",  # code blocks
        "\n\n|",  # tables
        "\n\n## ",  # h2
        "\n\n### ",  # h3
        "\n\n#### ",  # h4
        "\n\n",  # paragraph break
        "\n",  # line break
        " ",  # word break
        "",  # character break (last resort)
    ]

    def __init__(self, chunk_size: int = 1000, overlap_size: int = 200):
        self.chunk_size = chunk_size
        self.overlap_size = overlap_size

        if RecursiveCharacterTextSplitter is None:
            raise ImportError(
                "langchain text_splitter is required for SmartChunker. "
                "Install with: pip install langchain-text-splitters"
            )

        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=overlap_size,
            separators=self.SEPARATORS,
            keep_separator=True,
        )

    def chunk_pages(self, pages: list) -> list[ChunkedDocument]:
        """
        Chunk a list of page objects (anything with .page_content and .metadata).

        This is the main entry point for the agentic RAG pipeline.
        """
        chunks: list[ChunkedDocument] = []

        for idx, page in enumerate(pages):
            text = getattr(page, "page_content", "")
            metadata = getattr(page, "metadata", {})
            normalized = self._clean_markdown_text(text)

            if not normalized.strip():
                continue

            # Small pages go in as single chunks
            if len(normalized) <= self.chunk_size:
                chunks.append(
                    ChunkedDocument(
                        page_content=normalized,
                        metadata=metadata,
                    )
                )
                continue

            # Extract structural blocks and build chunks
            blocks = self._extract_markdown_blocks(normalized)
            page_chunks = self._build_chunks_from_blocks(blocks)

            for chunk_text in page_chunks:
                if chunk_text.strip():
                    chunks.append(
                        ChunkedDocument(
                            page_content=chunk_text.strip(),
                            metadata=metadata,
                        )
                    )

        return chunks

    def chunk_text(self, raw_text: str) -> list[str]:
        """
        Simple text chunking (no metadata tracking).

        Convenience method for when you just need text chunks.
        """
        clean = raw_text.replace("\x00", "")
        clean = re.sub(r"\n{3,}", "\n\n", clean)
        return self._splitter.split_text(clean)

    # ── Block extraction ─────────────────────────────────────────────────

    def _extract_markdown_blocks(self, text: str) -> list[dict[str, str]]:
        """Parse markdown text into typed blocks (heading, code, table, list, paragraph)."""
        lines = text.split("\n")
        blocks: list[dict[str, str]] = []
        current_lines: list[str] = []
        in_code_block = False

        for line in lines:
            stripped = line.strip()

            # Code block toggle
            if stripped.startswith("```"):
                if current_lines:
                    blocks.append(self._make_block(current_lines))
                    current_lines = []
                current_lines.append(line)
                in_code_block = not in_code_block
                if not in_code_block:
                    blocks.append({"type": "code", "text": "\n".join(current_lines).strip()})
                    current_lines = []
                continue

            if in_code_block:
                current_lines.append(line)
                continue

            # Empty line = block separator
            if stripped == "":
                if current_lines:
                    blocks.append(self._make_block(current_lines))
                    current_lines = []
                continue

            # Table lines
            if self._is_table_line(stripped):
                if current_lines and not self._is_table_line(current_lines[-1].strip()):
                    blocks.append(self._make_block(current_lines))
                    current_lines = []
                current_lines.append(line)
                continue

            # End of table
            if current_lines and self._is_table_line(current_lines[-1].strip()):
                blocks.append({"type": "table", "text": "\n".join(current_lines).strip()})
                current_lines = []

            current_lines.append(line)

        # Flush remaining
        if current_lines:
            if self._is_table_line(current_lines[0].strip()):
                blocks.append({"type": "table", "text": "\n".join(current_lines).strip()})
            else:
                blocks.append(self._make_block(current_lines))

        return blocks

    def _make_block(self, lines: list[str]) -> dict[str, str]:
        text = "\n".join(lines).strip()
        if not text:
            return {"type": "paragraph", "text": ""}

        first = lines[0].strip()
        if first.startswith("#"):
            return {"type": "heading", "text": text}
        if self._is_list_item(first):
            return {"type": "list", "text": text}
        return {"type": "paragraph", "text": text}

    # ── Chunk assembly ───────────────────────────────────────────────────

    def _build_chunks_from_blocks(self, blocks: list[dict[str, str]]) -> list[str]:
        """Assemble blocks into chunks respecting size limits and structure."""
        chunks: list[str] = []
        current_blocks: list[str] = []

        def flush():
            nonlocal current_blocks
            if not current_blocks:
                return
            chunks.append("\n\n".join(current_blocks).strip())

            # Block-level overlap
            if self.overlap_size <= 0:
                current_blocks = []
                return

            overlap, length = [], 0
            for prev in reversed(current_blocks):
                overlap.insert(0, prev)
                length += len(prev) + 2
                if length >= self.overlap_size:
                    break
            current_blocks = overlap

        for block in blocks:
            block_text = block.get("text", "").strip()
            if not block_text:
                continue

            is_protected = block.get("type") in {"code", "table"}

            # Oversized non-protected blocks: split with langchain
            if len(block_text) > self.chunk_size and not is_protected:
                flush()
                for segment in self._splitter.split_text(block_text):
                    if segment.strip():
                        chunks.append(segment.strip())
                continue

            # Check if adding this block exceeds the limit
            candidate = [*current_blocks, block_text]
            candidate_text = "\n\n".join(candidate)
            if current_blocks and len(candidate_text) > self.chunk_size:
                flush()
                current_blocks.append(block_text)
            else:
                current_blocks = candidate

        flush()
        return chunks

    # ── Utilities ────────────────────────────────────────────────────────

    @staticmethod
    def _is_table_line(line: str) -> bool:
        if "|" not in line:
            return False
        if re.match(r"^\|\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$", line):
            return True
        return line.count("|") >= 2

    @staticmethod
    def _is_list_item(text: str) -> bool:
        return bool(re.match(r"^([-*+\u2022\u25E6\u25AA\u2023]|\d+[.)])\s+", text))

    @staticmethod
    def _clean_markdown_text(text: str) -> str:
        """Normalize whitespace while preserving code blocks."""
        normalized = text.replace("\r\n", "\n").replace("\r", "\n")

        code_blocks: list[str] = []

        def protect(match):
            code_blocks.append(match.group(0))
            return f"__CODE_BLOCK_{len(code_blocks) - 1}__"

        protected = re.compile(r"```[\s\S]*?```").sub(protect, normalized)
        protected = re.sub(r"[ \t]+", " ", protected)
        protected = re.sub(r"\n{3,}", "\n\n", protected)

        cleaned = "\n".join(line.rstrip() for line in protected.split("\n")).strip()

        for idx, block in enumerate(code_blocks):
            cleaned = cleaned.replace(f"__CODE_BLOCK_{idx}__", block)

        return cleaned
