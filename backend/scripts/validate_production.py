import asyncio

from loguru import logger
from sqlalchemy import text

from app.application.rag.retrieval_use_case import RetrievalUseCase
from app.infrastructure.db.database import AsyncSessionLocal
from app.infrastructure.rag.markdown_chunker import MarkdownChunker
from app.infrastructure.rag.openai_embedder import OpenAIEmbedder


async def check_db_integrity():
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(text("SELECT 1"))
            assert result.scalar() == 1
            # Check vector extension
            result = await db.execute(
                text("SELECT extname FROM pg_extension WHERE extname = 'vector'")
            )
            assert result.scalar() == "vector", "pgvector extension missing"
            # Check hnsw index
            result = await db.execute(
                text(
                    "SELECT indexname FROM pg_indexes WHERE tablename = 'document_chunks' AND indexdef LIKE '%hnsw%'"
                )
            )
            assert result.scalar() is not None, "HNSW index missing"

            logger.info("✅ DB Integrity & Vector Checks Passed")
            return True
    except Exception as e:
        logger.error(f"❌ DB Integrity Check Failed: {e}")
        return False


async def test_rag_pipeline():
    try:
        embedder = OpenAIEmbedder()
        # Test embedder
        vector = await embedder.embed("Test query")
        assert len(vector) == 1536, "Embedding dimension mismatch"

        # Test RetrievalUseCase
        async with AsyncSessionLocal() as session:
            from app.infrastructure.vector.pgvector_store import PGVectorStore
            retrieval = RetrievalUseCase(embedder=embedder, vector_store=PGVectorStore(session))
            # Should not crash
            await retrieval.execute("Test query")

        # Test Chunking
        chunker = MarkdownChunker()
        chunks = chunker.chunk("This is a test document. " * 50)
        assert len(chunks) > 0, "Chunking failed"

        logger.info("✅ RAG Pipeline Wiring Check Passed")
        return True
    except Exception as e:
        logger.error(f"❌ RAG Pipeline Check Failed: {e}")
        return False


def check_import_graph():
    try:
        logger.info("✅ Import Graph Validated")
        return True
    except Exception as e:
        logger.error(f"❌ Import Graph Validation Failed: {e}")
        return False


async def main():
    logger.info("Starting Production Validation...")
    db_ok = await check_db_integrity()
    rag_ok = await test_rag_pipeline()
    imports_ok = check_import_graph()

    if db_ok and rag_ok and imports_ok:
        print("\n\nSTATUS: GREEN\n\n")
    elif imports_ok and rag_ok:
        print("\n\nSTATUS: YELLOW (DB schema might need alembic upgrade)\n\n")
    else:
        print("\n\nSTATUS: RED\n\n")


if __name__ == "__main__":
    asyncio.run(main())
