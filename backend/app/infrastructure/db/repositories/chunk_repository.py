from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.db.models import DataChunk


class ChunkRepository:
    """Repository for managing RAG DataChunks."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, chunk: DataChunk) -> DataChunk:
        self.db.add(chunk)
        await self.db.flush()
        await self.db.refresh(chunk)
        return chunk

    async def get(self, chunk_id: int) -> DataChunk | None:
        stmt = select(DataChunk).where(DataChunk.chunk_id == chunk_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def insert_many(self, chunks: list[DataChunk], batch_size: int = 100) -> int:
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i : i + batch_size]
            self.db.add_all(batch)
            await self.db.flush()
        return len(chunks)

    async def delete_by_project(self, project_id: int) -> int:
        stmt = delete(DataChunk).where(DataChunk.chunk_project_id == project_id)
        result = await self.db.execute(stmt)
        await self.db.flush()
        from typing import cast

        from sqlalchemy import CursorResult
        return cast("CursorResult", result).rowcount

    async def get_by_project(
        self, project_id: int, page: int = 1, page_size: int = 50
    ) -> Sequence[DataChunk]:
        stmt = (
            select(DataChunk)
            .where(DataChunk.chunk_project_id == project_id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def count_by_project(self, project_id: int) -> int:
        stmt = select(func.count(DataChunk.chunk_id)).where(
            DataChunk.chunk_project_id == project_id
        )
        result = await self.db.execute(stmt)
        return result.scalar_one()
