import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.rag.ports import VisualizationProviderPort
from app.infrastructure.db.models import Message, VisualizationCache


class VisualizationDomainException(Exception):
    pass


class VisualizationUseCase:
    """Use case for requesting Napkin visualization based on an existing message."""

    def __init__(self, provider: VisualizationProviderPort):
        self.provider = provider

    async def get_visualization(
        self, db: AsyncSession, message_id: str, user_id: str
    ) -> dict[str, Any]:
        msg_uuid = uuid.UUID(message_id)
        user_uuid = uuid.UUID(user_id)

        # 1. Check cache
        existing_query = await db.execute(
            select(VisualizationCache).where(VisualizationCache.message_id == msg_uuid)
        )
        cached = existing_query.scalar_one_or_none()
        if cached:
            return {
                "message_id": message_id,
                "image_url": cached.image_url,
                "unavailable": cached.unavailable,
                "reason": cached.reason,
            }

        # 2. Verify access and fetch message text
        from app.infrastructure.db.models import ChatSession

        msg_query = await db.execute(
            select(Message)
            .join(ChatSession, ChatSession.id == Message.session_id)
            .where(Message.id == msg_uuid, ChatSession.user_id == user_uuid)
        )
        message = msg_query.scalar_one_or_none()

        if not message:
            raise VisualizationDomainException("Message not found or unauthorized.")

        text = message.content or ""

        # 3. Call Provider
        result = await self.provider.generate_diagram(text)

        # 4. Save Cache
        is_unavailable = result.get("unavailable", False)

        cache_entry = VisualizationCache(
            message_id=msg_uuid,
            image_url=result.get("image_url"),
            unavailable=is_unavailable,
            reason=result.get("reason"),
        )
        db.add(cache_entry)
        await db.commit()

        return {
            "message_id": message_id,
            "image_url": cache_entry.image_url,
            "unavailable": cache_entry.unavailable,
            "reason": cache_entry.reason,
        }
