import json
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.application.rag.quiz_use_case import QuizUseCase, QuizDomainException
from app.domain.chat.entities import LLMChunk, LLMResult
from app.domain.rag.task_types import Locale
from app.infrastructure.db.models import DocumentChunk, Quiz, QuizQuestion


class MockLLMProvider:
    def __init__(self):
        self.complete_mock = AsyncMock()

    async def complete(self, history):
        return await self.complete_mock(history)


@pytest.mark.asyncio
async def test_quiz_use_case_no_chunks():
    db = AsyncMock()
    # No chunks
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []
    db.execute.return_value = mock_result

    llm = MockLLMProvider()
    use_case = QuizUseCase(llm)

    with pytest.raises(QuizDomainException, match="No content found"):
        await use_case.generate_quiz(db, str(uuid.uuid4()), str(uuid.uuid4()))


@pytest.mark.asyncio
async def test_quiz_use_case_json_parsing_success():
    db = AsyncMock()
    db.add = MagicMock()
    
    chunk = DocumentChunk(chunk_text="Some facts", chunk_order=1)
    
    class ExecResult:
        def __init__(self, all_res=None):
            self._all_res = all_res
        def scalars(self):
            class Scalars:
                def all(s):
                    return self._all_res
            return Scalars()
            
    db.execute.return_value = ExecResult(all_res=[chunk])
    
    llm = MockLLMProvider()
    
    good_json = [
        {
            "question_text": "Q1?",
            "options": ["A", "B", "C", "D"],
            "correct_option_index": 0,
            "explanation": "Exp",
            "citations": []
        }
    ]
    # Wrap with markdown to test fallback parser
    llm.complete_mock.return_value = LLMResult(
        full_text=f"```json\n{json.dumps(good_json)}\n```"
    )

    use_case = QuizUseCase(llm)
    quiz_id = await use_case.generate_quiz(db, str(uuid.uuid4()), str(uuid.uuid4()))

    assert quiz_id is not None
    assert llm.complete_mock.call_count == 1
    # db.add should be called for Quiz and QuizQuestion
    assert db.add.call_count == 2


@pytest.mark.asyncio
async def test_quiz_use_case_json_parsing_retry_success():
    db = AsyncMock()
    db.add = MagicMock()
    
    chunk = DocumentChunk(chunk_text="Some facts", chunk_order=1)
    
    class ExecResult:
        def __init__(self, all_res=None):
            self._all_res = all_res
        def scalars(self):
            class Scalars:
                def all(s):
                    return self._all_res
            return Scalars()
            
    db.execute.return_value = ExecResult(all_res=[chunk])
    
    llm = MockLLMProvider()
    
    bad_output = "I couldn't generate a quiz."
    good_json = [{"question_text": "Q1?", "options": ["A","B","C","D"], "correct_option_index": 0, "explanation": "Exp", "citations": []}]
    good_output = json.dumps(good_json)
    
    # First fails, second succeeds
    llm.complete_mock.side_effect = [
        LLMResult(full_text=bad_output),
        LLMResult(full_text=good_output)
    ]

    use_case = QuizUseCase(llm)
    quiz_id = await use_case.generate_quiz(db, str(uuid.uuid4()), str(uuid.uuid4()))

    assert quiz_id is not None
    assert llm.complete_mock.call_count == 2
    assert db.add.call_count == 2


@pytest.mark.asyncio
async def test_quiz_use_case_json_parsing_failure():
    db = AsyncMock()
    db.add = MagicMock()
    
    chunk = DocumentChunk(chunk_text="Some facts", chunk_order=1)
    
    class ExecResult:
        def __init__(self, all_res=None):
            self._all_res = all_res
        def scalars(self):
            class Scalars:
                def all(s):
                    return self._all_res
            return Scalars()
            
    db.execute.return_value = ExecResult(all_res=[chunk])
    
    llm = MockLLMProvider()
    
    bad_output = "I couldn't generate a quiz."
    llm.complete_mock.return_value = LLMResult(full_text=bad_output)

    use_case = QuizUseCase(llm)
    with pytest.raises(QuizDomainException, match="Failed to generate a valid quiz JSON after 3 attempts."):
        await use_case.generate_quiz(db, str(uuid.uuid4()), str(uuid.uuid4()))

    assert llm.complete_mock.call_count == 3
