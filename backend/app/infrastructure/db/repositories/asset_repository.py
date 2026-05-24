from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.db.models import Asset


class AssetRepository:
    """Repository for managing RAG Assets."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, asset: Asset) -> Asset:
        self.db.add(asset)
        await self.db.flush()
        await self.db.refresh(asset)
        return asset

    async def get_by_project_and_type(self, project_id: int, asset_type: str) -> Sequence[Asset]:
        stmt = select(Asset).where(
            Asset.asset_project_id == project_id, Asset.asset_type == asset_type
        )
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def get_by_project_and_name(self, project_id: int, asset_name: str) -> Asset | None:
        stmt = select(Asset).where(
            Asset.asset_project_id == project_id, Asset.asset_name == asset_name
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
