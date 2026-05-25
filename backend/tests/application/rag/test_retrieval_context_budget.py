from uuid import uuid4

import pytest

from app.application.rag.retrieval_use_case import RetrievalUseCase
from app.application.rag.token_budget import TokenBudgetManager
from app.domain.rag.entities import DocumentChunk, RetrievedDocument


def test_token_budget_accepts_retrieved_documents() -> None:
    budget = TokenBudgetManager()
    chunks = [
        RetrievedDocument(
            text="Lecture notes about arithmetic and functions.",
            score=0.9,
            metadata={"source": "Sec_1.pdf"},
            id="chunk-1",
        )
    ]

    fitted = budget.fit_chunks_to_budget(
        chunks=chunks,
        system_prompt="You are a tutor.",
        user_query="Summarize this lecture",
        max_context_tokens=200,
    )

    assert fitted == chunks
    assert fitted[0].chunk_text == chunks[0].text


@pytest.mark.asyncio
async def test_retrieval_uses_session_scope_and_source_metadata() -> None:
    session_id = str(uuid4())

    class FakeEmbedder:
        async def embed(self, text: str) -> list[float]:
            return [0.1, 0.2]

    class FakeVectorStore:
        def __init__(self) -> None:
            self.scope = None
            self.scope_id = None

        async def hybrid_search(self, **kwargs):
            self.scope = kwargs.get("scope")
            self.scope_id = kwargs.get("scope_id")
            return [
                (
                    DocumentChunk(
                        id=uuid4(),
                        document_id=uuid4(),
                        chunk_text="Lecture section content.",
                        chunk_order=0,
                        embedding=None,
                        metadata={"source": "Sec_1.pdf"},
                    ),
                    1.0,
                )
            ]

    vector_store = FakeVectorStore()
    retrieval = RetrievalUseCase(embedder=FakeEmbedder(), vector_store=vector_store)

    context = await retrieval.execute("summarize it", session_id=session_id)

    assert vector_store.scope == "SESSION"
    assert str(vector_store.scope_id) == session_id
    assert "--- Document: Sec_1.pdf ---" in context
    assert "Lecture section content." in context
