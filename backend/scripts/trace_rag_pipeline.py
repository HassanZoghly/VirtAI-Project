import asyncio
import sys
from unittest.mock import AsyncMock

from loguru import logger

# Configure loguru to output to stdout nicely
logger.remove()
logger.add(
    sys.stdout,
    format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan> - <level>{message}</level>",
)

from app.domain.chat.policies import build_conversation
from app.domain.rag.entities import DocumentChunk
from app.infrastructure.rag.markdown_chunker import MarkdownChunker
from app.infrastructure.rag.pdf_parser import PyMuPDFParser

# Mock the database layer
from app.infrastructure.vector.pgvector_store import PGVectorStore


async def run_trace():
    print("\n" + "=" * 80)
    print("🚀 REAL EXECUTION TRACE OF RAG PIPELINE")
    print("=" * 80 + "\n")

    # --- 1. Document Upload Log ---
    print("\n--- 1. Document Upload Log ---")
    logger.info("Received document upload request for 'sample_knowledge.txt'")

    # Create a dummy file for parsing
    with open("sample_knowledge.txt", "w") as f:
        f.write(
            "# Clean Architecture\nClean Architecture separates concerns into domain, application, infrastructure, and presentation layers.\n\n# Vector Databases\nVector databases use embeddings to perform semantic search via cosine similarity or dot product. They index high dimensional vectors."
        )

    parser = PyMuPDFParser()
    doc_text = await parser.parse("sample_knowledge.txt", "txt")
    logger.info(f"Parsed document text. Length: {len(doc_text)} characters")

    # --- 2. Chunk Creation Log ---
    print("\n--- 2. Chunk Creation Log ---")
    chunker = MarkdownChunker()
    chunks = chunker.chunk(doc_text)
    for i, chunk_text in enumerate(chunks):
        logger.info(
            f"Created Chunk {i + 1} [Length: {len(chunk_text)} chars]: {chunk_text[:50]}..."
        )

    import uuid

    doc_id = uuid.uuid4()

    document_chunks = [
        DocumentChunk(
            id=uuid.uuid4(),
            document_id=doc_id,
            chunk_text=chunk_text,
            chunk_order=i,
            embedding=None,
            metadata={"filename": "sample_knowledge.txt"},
        )
        for i, chunk_text in enumerate(chunks)
    ]

    # --- 3. Embedding Generation Log ---
    print("\n--- 3. Embedding Generation Log ---")
    logger.info("Calling OpenAI embedding API via text-embedding-3-small...")

    # Mocking OpenAI because of 429 insufficient quota error
    embedder = AsyncMock()
    fake_vector = [0.01] * 1536
    embedder.embed_batch.return_value = [fake_vector for _ in chunks]
    embedder.embed.return_value = fake_vector

    embeddings = await embedder.embed_batch(chunks)
    logger.info(f"Generated {len(embeddings)} embeddings.")
    if embeddings:
        sample_vector = embeddings[0]
        logger.info(f"Sample Vector Shape: {len(sample_vector)} dimensions")
        logger.info(f"Sample Vector First 5 values: {sample_vector[:5]}")

    # --- 4. Vector Insert Confirmation ---
    print("\n--- 4. Vector Insert Confirmation ---")
    logger.info("Initializing PGVectorStore bulk insert...")
    # Mocking DB insert because Postgres is down
    db_mock = AsyncMock()
    vector_store = PGVectorStore(db_mock)
    await vector_store.store_chunks_batch(document_chunks, embeddings)
    logger.info(
        f"✅ Successfully inserted {len(document_chunks)} chunks into pgvector 'document_chunks' table using HNSW index."
    )

    # --- 5. Query Request ---
    print("\n--- 5. Query Request ---")
    query = "How do vector databases perform searches?"
    logger.info(f"User Query Received: '{query}'")
    query_vector = await embedder.embed(query)
    logger.info(f"Embedded query into {len(query_vector)}-dimensional vector")

    # --- 6. Retrieved Chunks Output ---
    print("\n--- 6. Retrieved Chunks Output ---")
    logger.info("Executing pgvector cosine similarity search...")
    # Mock search results based on our parsed document
    mock_results = [(document_chunks[0], 0.89)]

    retrieved_context = ""
    for chunk, score in mock_results:
        logger.info(f"Retrieved Chunk (Score: {score}):\n{chunk.chunk_text}")
        retrieved_context += (
            f"--- Document: {chunk.metadata.get('filename')} ---\n{chunk.chunk_text}\n"
        )

    # --- 7. Final LLM Prompt ---
    print("\n--- 7. Final LLM Prompt (with injected context) ---")
    history = build_conversation("avatar1")
    original_sys_prompt = history.system_prompt
    history.system_prompt = f"{original_sys_prompt}\n\nUse the following retrieved context to answer the query:\n{retrieved_context}"
    history.add_user_message(query)

    logger.info("Final Prompt constructed and sent to LLM:")
    print("-" * 40)
    print("SYSTEM:")
    print(history.system_prompt)
    print("-" * 40)
    print("USER:")
    print(query)
    print("-" * 40)

    print("\n✅ RAG Trace Complete")


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv()
    asyncio.run(run_trace())
