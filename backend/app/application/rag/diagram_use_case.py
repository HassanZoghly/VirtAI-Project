import re
import uuid
from typing import Any

from loguru import logger
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.chat.entities import ConversationHistory
from app.domain.chat.ports import BaseLLMProvider
from app.domain.rag.task_types import Locale, TaskType
from app.infrastructure.db.models import DiagramCache, DocumentChunk
from app.infrastructure.rag.prompts.registry import get_prompt_set
from app.shared.errors import RAGException


class DiagramModel(BaseModel):
    mermaid_code: str
    citations: list[int]


DIAGRAM_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "diagram",
        "schema": {
            "type": "object",
            "properties": {
                "mermaid_code": {"type": "string"},
                "citations": {"type": "array", "items": {"type": "integer"}},
            },
            "required": ["mermaid_code", "citations"],
            "additionalProperties": False,
        },
        "strict": True,
    },
}


class DiagramDomainException(RAGException):
    pass


class DiagramUseCase:
    """Use case for generating a Mermaid.js diagram from a document."""

    def __init__(self, llm: BaseLLMProvider):
        self.llm = llm

    def _sanitize_mermaid(self, mermaid_code: str) -> str:
        """
        Sanitize the generated Mermaid code:
        - Strip markdown code blocks.
        - Ensure it starts with graph or flowchart.
        - Sanitize node text (remove quotes/parentheses).
        """
        # Strip markdown fences
        code = mermaid_code.strip()
        if code.startswith("```mermaid"):
            code = code[len("```mermaid") :].strip()
        elif code.startswith("```"):
            code = code[3:].strip()
        if code.endswith("```"):
            code = code[:-3].strip()

        if not (code.startswith("graph ") or code.startswith("flowchart ")):
            code = "flowchart TD\n" + code

        # Sanitize node text inside brackets like A[label]
        # Mermaid doesn't like quotes or parentheses inside the label unless escaped or in quotes (which is sometimes buggy).
        # Best to just remove them defensively.
        def replace_brackets(match: Any) -> str:
            inner = match.group(1)
            # Remove quotes and parentheses
            inner_safe = re.sub(r"[\"\'\(\)]", "", inner)
            return f"[{inner_safe}]"

        # Regex to find [...], but we must be careful not to match too broadly.
        # Match anything between [ and ] that doesn't contain [ or ].
        code = re.sub(r"\[([^\[\]]+)\]", replace_brackets, code)

        return code

    def _check_node_limit(self, mermaid_code: str) -> None:
        """Count lines. If > 60, raise domain exception."""
        lines = mermaid_code.split("\n")
        # A simple approximation for node/edge limit
        if len(lines) > 60:
            raise DiagramDomainException(
                "Generated diagram is too complex (> 60 nodes/lines) and may cause instability."
            )

    async def generate_diagram(
        self,
        db: AsyncSession,
        document_id: str,
        user_id: str,
        locale: Locale = Locale.EN,
    ) -> str:
        """
        Generates a diagram from the document chunks, parses JSON,
        sanitizes mermaid, and saves to DB. Returns diagram_id.
        """
        doc_uuid = uuid.UUID(document_id)
        uuid.UUID(user_id)

        # Check if already exists
        existing_query = await db.execute(
            select(DiagramCache).where(DiagramCache.document_id == doc_uuid)
        )
        existing = existing_query.scalar_one_or_none()
        if existing:
            return str(existing.id)

        # 1. Fetch chunks
        chunks_query = await db.execute(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == doc_uuid)
            .order_by(DocumentChunk.chunk_order)
        )
        chunks = chunks_query.scalars().all()

        if not chunks:
            raise DiagramDomainException("No content found to generate a diagram.")

        blocks = []
        for chunk in chunks:
            text = (chunk.chunk_text or "").strip()
            if not text:
                continue
            meta = chunk.chunk_metadata or {}
            label = f"Chunk: {meta.get('chunk_index', chunk.chunk_order)}"
            blocks.append(f"[{label}]\n{text}")

        # Limit to first ~30 chunks to prevent context overflow.
        max_chars = 12000
        current_len = 0
        selected_blocks = []
        for b in blocks:
            if current_len + len(b) > max_chars:
                break
            selected_blocks.append(b)
            current_len += len(b)

        lecture_text = "\n\n".join(selected_blocks)

        prompt_set = get_prompt_set(TaskType.DIAGRAM, locale)
        sys_prompt = prompt_set.system.safe_substitute()
        footer = prompt_set.footer.safe_substitute()

        user_text = f"--- Document Content ---\n\n{lecture_text}\n\n{footer}"

        # 2. Call LLM with retries
        diagram_data = None
        for attempt in range(3):
            logger.info(f"Generating diagram, attempt {attempt + 1}")
            history = ConversationHistory(system_prompt=sys_prompt)
            history.add_user_message(user_text)

            try:
                res = await self.llm.complete(history, response_format=DIAGRAM_SCHEMA)
                response_text = res.full_text.strip()

                diagram_data = DiagramModel.model_validate_json(response_text)
                break  # Success
            except Exception as e:
                logger.error(f"Diagram generation parsing failed: {e}")
                diagram_data = None

        if not diagram_data:
            raise DiagramDomainException(
                "Failed to generate a valid diagram JSON after 3 attempts."
            )

        # 3. Sanitize and Validate
        raw_mermaid = diagram_data.mermaid_code
        sanitized_mermaid = self._sanitize_mermaid(raw_mermaid)
        self._check_node_limit(sanitized_mermaid)
        citations = diagram_data.citations

        # 4. Save Diagram
        diagram = DiagramCache(
            document_id=doc_uuid, mermaid_code=sanitized_mermaid, citations=citations
        )
        db.add(diagram)
        await db.commit()
        return str(diagram.id)

    async def get_diagram(self, db: AsyncSession, diagram_id: str, user_id: str) -> dict[str, Any]:
        """Fetch a generated diagram."""
        diag_uuid = uuid.UUID(diagram_id)
        user_uuid = uuid.UUID(user_id)

        # Verify access via document
        from app.infrastructure.db.models import Document

        diag_query = await db.execute(
            select(DiagramCache, Document)
            .join(Document, Document.id == DiagramCache.document_id)
            .where(DiagramCache.id == diag_uuid, Document.user_id == user_uuid)
        )
        row = diag_query.first()
        if not row:
            raise DiagramDomainException("Diagram not found or unauthorized.")

        diag = row[0]

        return {
            "id": str(diag.id),
            "document_id": str(diag.document_id),
            "mermaid_code": diag.mermaid_code,
            "citations": diag.citations,
            "created_at": diag.created_at.isoformat() if diag.created_at else None,
        }
