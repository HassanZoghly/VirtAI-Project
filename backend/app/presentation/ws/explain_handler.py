import asyncio
import json
import uuid
from enum import Enum
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect
from loguru import logger
from pydantic import BaseModel, ValidationError

from app.domain.rag.task_types import TaskType, Locale
from app.infrastructure.db.models import DocumentChunk, Document
from app.application.chat.chat_use_case import ChatUseCase
from app.domain.rag.explain_entities import PresentationState, SlideStartEvent, SlideContentTokens, SlideEndEvent, AwaitInputEvent

# In-memory "Redis" cache equivalent for persistence
_explain_sessions_cache = {}

class ExplainHandler:
    def __init__(self, websocket: WebSocket, document_id: str, db, user_id: str, chat_use_case: ChatUseCase):
        self.websocket = websocket
        self.document_id = document_id
        self.db = db
        self.user_id = user_id
        self.chat_use_case = chat_use_case
        self.chunks = []
        self._main_task: Optional[asyncio.Task] = None
        
        # State tracking for reconnects
        # Use a deterministic key based on user and document
        self.session_key = f"explain_{user_id}_{document_id}"
        
        if self.session_key in _explain_sessions_cache:
            state_data = _explain_sessions_cache[self.session_key]
            self.current_slide_index = state_data["current_slide_index"]
            self.state = state_data["state"]
        else:
            self.current_slide_index = 0
            self.state = PresentationState.EXPLAINING
            _explain_sessions_cache[self.session_key] = {
                "current_slide_index": self.current_slide_index,
                "state": self.state
            }

    def _update_cache(self):
        _explain_sessions_cache[self.session_key] = {
            "current_slide_index": self.current_slide_index,
            "state": self.state
        }


    async def _load_chunks(self):
        from sqlalchemy import select
        doc_uuid = uuid.UUID(self.document_id)
        # Fetch chunks sorted by order
        chunks_query = await self.db.execute(
            select(DocumentChunk)
            .where(DocumentChunk.document_id == doc_uuid)
            .order_by(DocumentChunk.chunk_order)
        )
        self.chunks = chunks_query.scalars().all()
        
    async def run(self):
        await self._load_chunks()
        if not self.chunks:
            await self.websocket.send_json({"type": "error", "message": "No document content."})
            return
            
        # Start the presentation loop
        self._main_task = asyncio.create_task(self._presentation_loop())
        
        try:
            while True:
                raw = await self.websocket.receive_text()
                try:
                    data = json.loads(raw)
                    msg_type = data.get("type")
                    if msg_type == "chat.user_message" or msg_type == "client.speech_stopped":
                        await self._handle_interruption(data)
                except json.JSONDecodeError:
                    pass
        except WebSocketDisconnect:
            logger.info("Explain websocket disconnected.")
        finally:
            if self._main_task:
                self._main_task.cancel()
                
    async def _presentation_loop(self):
        try:
            while self.current_slide_index < len(self.chunks):
                self.state = PresentationState.EXPLAINING
                self._update_cache()
                
                await self.websocket.send_json({
                    "type": "SlideStartEvent",
                    "slide_index": self.current_slide_index,
                    "total_slides": len(self.chunks)
                })
                
                chunk = self.chunks[self.current_slide_index]
                text = chunk.chunk_text or ""
                
                # Simulate streaming LLM/TTS
                words = text.split(" ")
                for word in words:
                    await asyncio.sleep(0.1) # Simulate TTS stream
                    await self.websocket.send_json({
                        "type": "SlideContentTokens",
                        "tokens": word + " "
                    })
                
                await self.websocket.send_json({
                    "type": "SlideEndEvent",
                    "slide_index": self.current_slide_index
                })
                
                self.state = PresentationState.AWAITING
                self._update_cache()
                
                await self.websocket.send_json({
                    "type": "AwaitInputEvent"
                })
                
                # Wait indefinitely until AWAITING is resolved by user input
                while self.state == PresentationState.AWAITING:
                    await asyncio.sleep(0.5)
                    
            # End of presentation
            await self.websocket.send_json({"type": "SlideEndEvent", "slide_index": -1})
        except asyncio.CancelledError:
            pass

    async def _handle_interruption(self, data: dict):
        # Cancel the EXPLAINING stream if active
        if self.state == PresentationState.EXPLAINING:
            if self._main_task and not self._main_task.done():
                self._main_task.cancel()
            
        self.state = PresentationState.ANSWERING
        self._update_cache()
        
        user_text = data.get("data", {}).get("text", "")
        
        if "continue" in user_text.lower() or "next" in user_text.lower():
            self.current_slide_index += 1
            self.state = PresentationState.EXPLAINING
            self._update_cache()
            
            self._main_task = asyncio.create_task(self._presentation_loop())
            return
            
        # Call ChatUseCase constrained to current chunk
        # Pass current_slide_index as metadata filter
        await self._answer_question(user_text)

        # After answering, transition back to AWAITING
        self.state = PresentationState.AWAITING
        self._update_cache()
        
        await self.websocket.send_json({
            "type": "SlideContentTokens",
            "tokens": "\nShould we continue or do you have more questions?"
        })
        await self.websocket.send_json({"type": "AwaitInputEvent"})

    async def _answer_question(self, user_text: str):
        # Slide-Scoped RAG
        # We pass the slide_index to VectorStore via chat_use_case
        metadata_filter = {"slide_index": self.current_slide_index}
        
        response_text = await self.chat_use_case.execute_rag_query(
            query=user_text,
            user_id=self.user_id,
            session_id=None,
            document_id=self.document_id,
            metadata_filter=metadata_filter
        )
        
        await self.websocket.send_json({
            "type": "SlideContentTokens",
            "tokens": response_text
        })
