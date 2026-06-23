import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from app.presentation.ws.explain_handler import ExplainHandler, PresentationState
from app.infrastructure.db.models import DocumentChunk


@pytest.mark.asyncio
async def test_explain_handler_interruption(monkeypatch):
    monkeypatch.setattr(ExplainHandler, "_answer_question", AsyncMock())
    mock_ws = AsyncMock()
    mock_db = AsyncMock()
    
    chunk = DocumentChunk(chunk_text="Hello slide one", chunk_order=1)
    
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [chunk]
    mock_db.execute.return_value = mock_result
    
    from app.application.chat.chat_use_case import ChatUseCase
    mock_chat_use_case = AsyncMock(spec=ChatUseCase)
    mock_chat_use_case.execute_rag_query.return_value = "Answering based on slide 0: [RAG Context Applied]..."
    
    handler = ExplainHandler(mock_ws, "00000000-0000-0000-0000-000000000000", mock_db, "user", mock_chat_use_case)
    
    await handler._load_chunks()
    assert len(handler.chunks) == 1
    
    # Start loop
    handler._main_task = asyncio.create_task(handler._presentation_loop())
    
    # Let it start
    await asyncio.sleep(0.05)
    assert handler.state == PresentationState.EXPLAINING
    
    # Send interruption
    await handler._handle_interruption({"data": {"text": "what does it mean?"}})
    await asyncio.sleep(0.01)  # Let loop process cancellation
    
    assert handler._main_task.cancelled() or handler._main_task.done()
    assert handler.state == PresentationState.AWAITING
    
    # Verify sent events
    sent_messages = [c[0][0] for c in mock_ws.send_json.call_args_list]
    
    has_slide_start = any(msg.get("type") == "SlideStartEvent" for msg in sent_messages)
    has_await_input = any(msg.get("type") == "AwaitInputEvent" for msg in sent_messages)
    
    assert has_slide_start
    assert has_await_input

@pytest.mark.asyncio
async def test_explain_handler_continue(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "dummy")
    mock_ws = AsyncMock()
    mock_db = AsyncMock()
    
    chunk1 = DocumentChunk(chunk_text="Slide 1", chunk_order=1)
    chunk2 = DocumentChunk(chunk_text="Slide 2", chunk_order=2)
    
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = [chunk1, chunk2]
    mock_db.execute.return_value = mock_result
    
    from app.application.chat.chat_use_case import ChatUseCase
    mock_chat_use_case = AsyncMock(spec=ChatUseCase)
    mock_chat_use_case.execute_rag_query.return_value = "Answering based on slide 0: [RAG Context Applied]..."
    
    handler = ExplainHandler(mock_ws, "00000000-0000-0000-0000-000000000000", mock_db, "user", mock_chat_use_case)
    await handler._load_chunks()
    
    handler._main_task = asyncio.create_task(handler._presentation_loop())
    await asyncio.sleep(0.05)
    
    # Send "continue"
    await handler._handle_interruption({"data": {"text": "continue to next slide"}})
    
    assert handler.current_slide_index == 1
    assert handler.state == PresentationState.EXPLAINING
    
    await asyncio.sleep(0.05)
    # End
    handler._main_task.cancel()
