"""Quick verification script to check DB, pgvector, tables, and embedding provider."""

import asyncio

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

DB_URL = "postgresql+asyncpg://postgres:postgres@localhost:5432/virtai"


async def verify():
    results = {}

    # 1. Database connectivity
    try:
        engine = create_async_engine(DB_URL)
        async with engine.connect() as conn:
            r = await conn.execute(text("SELECT 1"))
            results["db_connection"] = f"OK (result={r.scalar()})"

            # 2. pgvector extension
            r2 = await conn.execute(
                text("SELECT extname FROM pg_extension WHERE extname = 'vector'")
            )
            ext = r2.scalar()
            results["pgvector"] = f"OK (ext={ext})" if ext == "vector" else "MISSING"

            # 3. Tables
            r3 = await conn.execute(
                text(
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
                )
            )
            tables = [row[0] for row in r3.all()]
            results["tables"] = tables

            # 4. Vector column check
            r4 = await conn.execute(
                text(
                    "SELECT column_name, udt_name FROM information_schema.columns WHERE table_name = 'document_chunks' AND column_name = 'embedding'"
                )
            )
            row = r4.first()
            results["vector_column"] = f"{row[0]} ({row[1]})" if row else "MISSING"

            # 5. Alembic version
            r5 = await conn.execute(text("SELECT version_num FROM alembic_version"))
            ver = r5.scalar()
            results["alembic_version"] = ver

        await engine.dispose()
    except Exception as e:
        results["db_error"] = str(e)

    # 6. FastEmbed availability
    try:
        from fastembed import TextEmbedding

        model = TextEmbedding("BAAI/bge-small-en-v1.5")
        vecs = list(model.embed(["test embedding"]))
        dim = len(vecs[0])
        results["fastembed"] = f"OK (dim={dim})"
    except Exception as e:
        results["fastembed_error"] = str(e)

    # 7. Redis
    try:
        import redis.asyncio as aioredis

        r = aioredis.from_url("redis://localhost:6379/0")
        await r.ping()
        results["redis"] = "OK"
        await r.aclose()
    except Exception as e:
        results["redis_error"] = str(e)

    for k, v in results.items():
        print(f"  {k}: {v}")


asyncio.run(verify())
