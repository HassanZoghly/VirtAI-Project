import json
import re
import uuid
from typing import List, Dict, Any

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.chat.entities import ConversationHistory
from app.domain.chat.ports import BaseLLMProvider
from app.domain.rag.task_types import Locale, TaskType
from app.infrastructure.db.models import DocumentChunk, Quiz, QuizQuestion
from app.infrastructure.rag.prompts.registry import get_prompt_set


class QuizDomainException(Exception):
    pass


class QuizUseCase:
    """Use case for generating a quiz from a document."""

    def __init__(self, llm: BaseLLMProvider):
        self.llm = llm

    async def generate_quiz(
        self,
        db: AsyncSession,
        document_id: str,
        user_id: str,
        num_questions: int = 5,
        locale: Locale = Locale.EN,
    ) -> str:
        """
        Generates a quiz from the document chunks, parses JSON with fallback,
        and saves it to the DB. Returns the quiz_id.
        """
        doc_uuid = uuid.UUID(document_id)
        user_uuid = uuid.UUID(user_id)

        # 1. Fetch chunks
        chunks_query = await db.execute(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == doc_uuid)
            .order_by(DocumentChunk.chunk_order)
        )
        chunks = chunks_query.scalars().all()

        if not chunks:
            raise QuizDomainException("No content found to generate a quiz.")

        blocks = []
        for chunk in chunks:
            text = (chunk.chunk_text or "").strip()
            if not text:
                continue
            meta = chunk.chunk_metadata or {}
            label = f"Chunk: {meta.get('chunk_index', chunk.chunk_order)}"
            blocks.append(f"[{label}]\n{text}")

        max_chars = 12000
        current_len = 0
        selected_blocks = []
        for b in blocks:
            if current_len + len(b) > max_chars:
                break
            selected_blocks.append(b)
            current_len += len(b)

        lecture_text = "\n\n".join(selected_blocks)

        prompt_set = get_prompt_set(TaskType.QUIZ, locale)
        sys_prompt = prompt_set.system.safe_substitute(num_questions=num_questions)
        footer = prompt_set.footer.safe_substitute(num_questions=num_questions)

        user_text = f"--- Document Content ---\n\n{lecture_text}\n\n{footer}"

        # 2. Call LLM with up to 2 retries
        parsed_json = None
        for attempt in range(3):
            logger.info(f"Generating quiz, attempt {attempt + 1}")
            history = ConversationHistory(system_prompt=sys_prompt)
            history.add_user_message(user_text)
            
            try:
                res = await self.llm.complete(history)
                response_text = res.full_text.strip()
                
                # Regex fallback parser
                match = re.search(r'\[.*\]', response_text, re.DOTALL)
                if match:
                    json_str = match.group(0)
                else:
                    json_str = response_text
                    
                parsed_json = json.loads(json_str)
                
                if isinstance(parsed_json, list) and len(parsed_json) > 0:
                    break # Success
                else:
                    logger.warning("Parsed JSON is not a non-empty list.")
                    parsed_json = None
            except Exception as e:
                logger.error(f"Quiz generation parsing failed: {e}")
                parsed_json = None

        if not parsed_json:
            raise QuizDomainException("Failed to generate a valid quiz JSON after 3 attempts.")

        # 3. Save Quiz
        quiz = Quiz(document_id=doc_uuid, user_id=user_uuid)
        db.add(quiz)
        await db.flush() # get quiz.id

        # 4. Save QuizQuestions
        for q_data in parsed_json:
            question = QuizQuestion(
                quiz_id=quiz.id,
                question_text=q_data.get("question_text", "Untitled Question"),
                options=q_data.get("options", []),
                correct_option_index=q_data.get("correct_option_index", 0),
                explanation=q_data.get("explanation", ""),
                citations=q_data.get("citations", []),
            )
            db.add(question)
        
        await db.commit()
        return str(quiz.id)

    async def get_quiz(self, db: AsyncSession, quiz_id: str, user_id: str) -> Dict[str, Any]:
        """Fetch a generated quiz for replay."""
        quiz_uuid = uuid.UUID(quiz_id)
        user_uuid = uuid.UUID(user_id)
        
        quiz_query = await db.execute(select(Quiz).where(Quiz.id == quiz_uuid, Quiz.user_id == user_uuid))
        quiz = quiz_query.scalar_one_or_none()
        if not quiz:
            raise QuizDomainException("Quiz not found or unauthorized.")
            
        questions_query = await db.execute(select(QuizQuestion).where(QuizQuestion.quiz_id == quiz.id))
        questions = questions_query.scalars().all()
        
        return {
            "id": str(quiz.id),
            "document_id": str(quiz.document_id),
            "created_at": quiz.created_at.isoformat() if quiz.created_at else None,
            "questions": [
                {
                    "id": str(q.id),
                    "question_text": q.question_text,
                    "options": q.options,
                    "correct_option_index": q.correct_option_index,
                    "explanation": q.explanation,
                    "citations": q.citations,
                }
                for q in questions
            ]
        }
