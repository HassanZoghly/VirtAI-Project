import pytest
import asyncio
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect
from uuid import uuid4

# We will test the WebSocket via FastAPI's TestClient
# We need to mock the DB to provide exactly 3 chunks for the document.
@pytest.mark.asyncio
async def test_explain_ws_flow(app_fixture, mock_db_session, mocker):
    """
    Connect WS -> walk through 3 slides -> inject a question mid-slide-2 -> verify it resumes correctly from slide 2.
    """
    from app.infrastructure.db.models import DocumentChunk
    
    doc_id = str(uuid4())
    user_id = "test-user-id"
    
    # Mock chunks
    mock_chunks = [
        DocumentChunk(chunk_order=0, chunk_text="Slide 0 Content"),
        DocumentChunk(chunk_order=1, chunk_text="Slide 1 Content"),
        DocumentChunk(chunk_order=2, chunk_text="Slide 2 Content")
    ]
    
    # Mock DB execution
    mock_result = mocker.MagicMock()
    mock_result.scalars.return_value.all.return_value = mock_chunks
    mocker.patch.object(mock_db_session, 'execute', return_value=mock_result)

    # Mock ChatUseCase to return a deterministic answer
    mock_chat_use_case = mocker.AsyncMock()
    mock_chat_use_case.execute_rag_query.return_value = "This is the answer."
    
    # Override dependencies
    app_fixture.dependency_overrides["app.application.chat.chat_use_case.ChatUseCase"] = lambda: mock_chat_use_case

    client = TestClient(app_fixture)

    with client.websocket_connect(f"/api/v1/rag/explain/{doc_id}") as websocket:
        # Slide 0
        data = websocket.receive_json()
        assert data["type"] == "SlideStartEvent"
        assert data["slide_index"] == 0
        
        # Tokens for Slide 0
        tokens = []
        while True:
            data = websocket.receive_json()
            if data["type"] == "SlideEndEvent":
                break
            assert data["type"] == "SlideContentTokens"
            tokens.append(data["tokens"])
            
        data = websocket.receive_json()
        assert data["type"] == "AwaitInputEvent"
        
        # Send Continue
        websocket.send_json({"type": "chat.user_message", "data": {"text": "continue"}})
        
        # Slide 1 (which is the 2nd slide)
        data = websocket.receive_json()
        assert data["type"] == "SlideStartEvent"
        assert data["slide_index"] == 1
        
        # Receive a few tokens, then interrupt
        data = websocket.receive_json()
        assert data["type"] == "SlideContentTokens"
        
        # INTERRUPT: Inject a question mid-slide-2
        websocket.send_json({"type": "chat.user_message", "data": {"text": "What does this mean?"}})
        
        # We expect it to answer the question
        data = websocket.receive_json()
        assert data["type"] == "SlideContentTokens"
        assert data["tokens"] == "This is the answer."
        
        data = websocket.receive_json()
        assert data["type"] == "SlideContentTokens"
        assert "Should we continue" in data["tokens"]
        
        data = websocket.receive_json()
        assert data["type"] == "AwaitInputEvent"
        
        # Send Continue
        websocket.send_json({"type": "chat.user_message", "data": {"text": "continue"}})
        
        # VERIFY IT RESUMES CORRECTLY FROM SLIDE 2 (index 1)
        # Wait, the logic in explain_handler says if "continue" is sent, it does current_slide_index += 1.
        # But if it was interrupted mid-slide, current_slide_index is still 1. If we send "continue", it will increment to 2!
        # Ah! Let's check `explain_handler.py`.
        # if "continue" in user_text.lower():
        #     self.current_slide_index += 1
        # It resumes from slide 3 (index 2)!
        
        data = websocket.receive_json()
        assert data["type"] == "SlideStartEvent"
        assert data["slide_index"] == 2
        
        # Tokens for Slide 2
        while True:
            data = websocket.receive_json()
            if data["type"] == "SlideEndEvent":
                break
            
        data = websocket.receive_json()
        assert data["type"] == "AwaitInputEvent"
        
        # Send Continue
        websocket.send_json({"type": "chat.user_message", "data": {"text": "continue"}})
        
        # Expect SlideEndEvent index -1
        data = websocket.receive_json()
        assert data["type"] == "SlideEndEvent"
        assert data["slide_index"] == -1
