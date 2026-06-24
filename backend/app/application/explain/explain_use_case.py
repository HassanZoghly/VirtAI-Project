import asyncio
import json
import uuid
from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.chat.chat_use_case import ChatUseCase
from app.domain.rag.explain_entities import (
    AwaitInputEvent,
    PresentationState,
    SlideContentTokens,
    SlideEndEvent,
    SlideStartEvent,
)
from app.infrastructure.cache.redis_client import get_redis
from app.infrastructure.db.models import DocumentChunk
from app.shared.config import get_settings


class ExplainUseCase:
    def __init__(self, db: AsyncSession, chat_use_case: ChatUseCase):
        self.db = db
        self.chat_use_case = chat_use_case
        self.redis = get_redis()
        self.settings = get_settings()
        self.session_ttl = 3600  # 1 hour

    async def _get_state(self, session_key: str) -> dict[str, Any]:
        raw = await self.redis.get(session_key)
        if raw:
            return json.loads(raw)
        return {"current_slide_index": 0, "state": PresentationState.EXPLAINING.value}

    async def _save_state(self, session_key: str, state_data: dict):
        await self.redis.setex(session_key, self.session_ttl, json.dumps(state_data))

    async def _load_chunks(self, document_id: str) -> list[DocumentChunk]:
        doc_uuid = uuid.UUID(document_id)
        chunks_query = await self.db.execute(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == doc_uuid)
            .order_by(DocumentChunk.chunk_order)
        )
        return chunks_query.scalars().all()

    async def start_or_resume(self, user_id: str, document_id: str) -> AsyncGenerator[dict, None]:
        session_key = f"explain_{user_id}_{document_id}"
        state_data = await self._get_state(session_key)

        chunks = await self._load_chunks(document_id)
        if not chunks:
            yield {"type": "error", "message": "No document content."}
            return

        current_slide_index = state_data["current_slide_index"]

        if current_slide_index >= len(chunks):
            yield SlideEndEvent(slide_index=-1).model_dump()
            return

        state_data["state"] = PresentationState.EXPLAINING.value
        await self._save_state(session_key, state_data)

        yield SlideStartEvent(slide_index=current_slide_index, total_slides=len(chunks)).model_dump()

        chunk = chunks[current_slide_index]
        text = chunk.chunk_text or ""

        # Simulate streaming LLM/TTS
        words = text.split(" ")
        for word in words:
            await asyncio.sleep(0.1)
            yield SlideContentTokens(tokens=word + " ").model_dump()

        yield SlideEndEvent(slide_index=current_slide_index).model_dump()

        state_data["state"] = PresentationState.AWAITING.value
        await self._save_state(session_key, state_data)

        yield AwaitInputEvent().model_dump()

    async def handle_user_input(self, user_id: str, document_id: str, text: str) -> AsyncGenerator[dict, None]:
        session_key = f"explain_{user_id}_{document_id}"
        state_data = await self._get_state(session_key)

        if "continue" in text.lower() or "next" in text.lower():
            state_data["current_slide_index"] += 1
            await self._save_state(session_key, state_data)
            async for event in self.start_or_resume(user_id, document_id):
                yield event
            return

        state_data["state"] = PresentationState.ANSWERING.value
        await self._save_state(session_key, state_data)

        metadata_filter = {"slide_index": state_data["current_slide_index"]}

        response_text = await self.chat_use_case.execute_rag_query(
            query=text,
            user_id=user_id,
            session_id=None,
            document_id=document_id,
            metadata_filter=metadata_filter
        )

        yield SlideContentTokens(tokens=response_text).model_dump()

        state_data["state"] = PresentationState.AWAITING.value
        await self._save_state(session_key, state_data)

        yield SlideContentTokens(tokens="\nShould we continue or do you have more questions?").model_dump()
        yield AwaitInputEvent().model_dump()
