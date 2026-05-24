from __future__ import annotations

from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.db.models import Project


class ProjectRepository:
    """Repository for managing RAG Projects."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(self, project: Project) -> Project:
        self.db.add(project)
        await self.db.flush()
        await self.db.refresh(project)
        return project

    async def get_or_create(self, project_id: int) -> Project:
        """Fetch a project by integer ID, creating it if it doesn't exist."""
        stmt = select(Project).where(Project.project_id == project_id)
        result = await self.db.execute(stmt)
        project = result.scalar_one_or_none()

        if project is None:
            project = Project(project_id=project_id)
            self.db.add(project)
            await self.db.flush()
            await self.db.refresh(project)

        return project

    async def get_all(self, page: int = 1, page_size: int = 10) -> tuple[Sequence[Project], int]:
        """Returns paginated projects and total page count."""
        count_stmt = select(func.count(Project.project_id))
        total_count = (await self.db.execute(count_stmt)).scalar_one()

        total_pages = total_count // page_size
        if total_count % page_size > 0:
            total_pages += 1

        stmt = select(Project).offset((page - 1) * page_size).limit(page_size)
        result = await self.db.execute(stmt)
        return result.scalars().all(), total_pages
