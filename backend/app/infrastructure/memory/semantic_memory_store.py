import asyncio
import math
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from loguru import logger
from sqlalchemy import select

from app.domain.rag.ports import EmbeddingProvider, LLMGenerationProvider
from app.infrastructure.db.database import AsyncSessionLocal
from app.infrastructure.db.models import EpisodicMemory


class SemanticMemoryStore:
    """
    Semantic Memory implementation using EpisodicMemory table and vector search.
    Features: heuristic write filtering, background extraction, confidence gating,
    recency decay, salience weighting, and deduplication.
    """

    def __init__(self, embedder: EmbeddingProvider, llm_provider: LLMGenerationProvider | None = None):
        self.embedder = embedder
        self.llm_provider = llm_provider

    def should_store(self, content: str) -> bool:
        """Lightweight heuristic write filter"""
        if not content:
            return False
        words = content.split()
        if len(words) < 3:
            return False

        # very simple chitchat filter
        low_value_phrases = {"ok", "thanks", "hello", "yes", "no", "sure", "got it", "acknowledged"}
        if content.lower().strip() in low_value_phrases:
            return False

        return True

    def store_background(
        self, session_id: str, role: str, content: str, memory_type: str = "episodic"
    ):
        """Asynchronous background semantic extraction & embedding generation"""
        if not self.should_store(content):
            return

        asyncio.create_task(self._process_and_store(session_id, role, content, memory_type))

    async def _process_and_store(
        self, session_id: str, role: str, content: str, memory_type: str
    ):
        try:
            # Here we assign heuristic salience and extract preference signals
            salience = 1.0
            if "prefer" in content.lower() or "always" in content.lower() or "never" in content.lower() or "use" in content.lower():
                memory_type = "preference"
                salience = 1.5

            formatted_content = f"{role.upper()}: {content}"
            embedding = await self.embedder.embed(formatted_content)

            async with AsyncSessionLocal() as db:
                memory = EpisodicMemory(
                    session_id=session_id,
                    content=formatted_content,
                    embedding=embedding,
                    memory_type=memory_type,
                    salience=salience,
                )
                db.add(memory)
                await db.commit()
                logger.debug(
                    f"[SemanticMemory] Stored memory for session {session_id} | type={memory_type}"
                )

        except Exception as e:
            logger.error(f"[SemanticMemory] Background extraction failed: {e}")

        await self._check_compaction(session_id)

    async def _check_compaction(self, session_id: str):
        if not self.llm_provider:
            return

        try:
            async with AsyncSessionLocal() as db:
                stmt = (
                    select(EpisodicMemory)
                    .where(EpisodicMemory.session_id == session_id, EpisodicMemory.memory_type == "episodic")
                    .order_by(EpisodicMemory.created_at.asc())
                )
                result = await db.execute(stmt)
                memories = result.scalars().all()

                if len(memories) > 20:
                    to_compact = memories[:15]
                    content_to_summarize = "\n".join([m.content for m in to_compact])

                    system_prompt = (
                        "You are an AI memory archivist for an educational avatar. "
                        "Summarize the following past conversation turns into a single, highly dense, factual paragraph. "
                        "Retain all specific user preferences, learning progress, technical facts, and core topics discussed. "
                        "Strictly discard conversational filler, greetings, and generic pleasantries. "
                        "Write the summary in the exact primary language of the provided conversation text."
                    )
                    
                    chat_history = [self.llm_provider.construct_prompt(prompt=system_prompt, role="system")]
                    summary = await self.llm_provider.generate_text(
                        prompt=f"Conversation turns:\n{content_to_summarize}",
                        chat_history=chat_history,
                        max_output_tokens=500,
                    )
                    
                    if summary:
                        summary_content = f"SYSTEM_SUMMARY: {summary}"
                        embedding = await self.embedder.embed(summary_content)
                        
                        compressed_memory = EpisodicMemory(
                            session_id=session_id,
                            content=summary_content,
                            embedding=embedding,
                            memory_type="episodic",
                            salience=1.2,
                        )
                        db.add(compressed_memory)
                        
                        for m in to_compact:
                            await db.delete(m)
                            
                        await db.commit()
                        logger.info(f"[SemanticMemory] Compacted 15 memories into 1 for session {session_id}")
        except Exception as e:
            logger.error(f"[SemanticMemory] Compaction failed: {e}")

    async def search(
        self, session_id: str, query: str, limit: int = 4, min_confidence: float = 0.5
    ) -> list[dict[str, str]]:
        try:
            query_vector = await self.embedder.embed(query)

            async with AsyncSessionLocal() as db:
                stmt = (
                    select(
                        EpisodicMemory,
                        (1 - EpisodicMemory.embedding.cosine_distance(query_vector)).label(
                            "similarity"
                        ),
                    )
                    .where(EpisodicMemory.session_id == session_id)
                    .order_by(EpisodicMemory.embedding.cosine_distance(query_vector))
                    .limit(limit * 2)
                )
                result = await db.execute(stmt)
                rows = result.all()

                # Apply confidence gating, recency decay, and salience
                scored_memories = []
                now = datetime.now(timezone.utc)

                for row in rows:
                    memory = row[0]
                    sim = float(row[1])

                    if sim < min_confidence:
                        continue

                    # Recency decay (half-life of 7 days)
                    # We ensure tz awareness for math
                    created_at = memory.created_at
                    if created_at.tzinfo is None:
                        created_at = created_at.replace(tzinfo=timezone.utc)
                        
                    days_old = (now - created_at).total_seconds() / 86400.0
                    decay_factor = math.pow(0.5, days_old / 7.0)

                    # Salience boost for preferences
                    salience_boost = memory.salience

                    final_score = sim * decay_factor * salience_boost
                    scored_memories.append((memory, final_score))

                # Deduplication and Sort
                scored_memories.sort(key=lambda x: x[1], reverse=True)

                final_results = []
                seen_content = set()

                for memory, _ in scored_memories:
                    if memory.content not in seen_content:
                        seen_content.add(memory.content)
                        # extract role if formatted as ROLE: content
                        role = "user"
                        content = memory.content
                        if ": " in memory.content:
                            parts = memory.content.split(": ", 1)
                            role = parts[0].lower()
                            content = parts[1]

                        final_results.append({"role": role, "content": content})
                        if len(final_results) >= limit:
                            break

                return final_results

        except Exception as e:
            logger.error(f"[SemanticMemory] Search failed: {e}")
            return []
