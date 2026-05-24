from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.rag.entities import AgentAction
from app.infrastructure.db.database import get_db
from app.infrastructure.db.repositories.chunk_repository import ChunkRepository
from app.infrastructure.db.repositories.project_repository import ProjectRepository
from app.presentation.http.v1.dependencies import NLPOperationsDep

router = APIRouter()


class RAGQueryRequest(BaseModel):
    session_id: str = Field(..., description="Unique session identifier for memory context.")
    query: str = Field(default="", description="The query to ask the agent.")
    limit: int = Field(default=5, description="Number of documents to retrieve for context.")


@router.post(
    "/projects/{project_id}/documents/index", summary="Index project documents into Vector DB"
)
async def index_project_documents(
    project_id: int,
    nlp: NLPOperationsDep,
    db: AsyncSession = Depends(get_db),
):
    """
    Triggers embedding and vector DB storage for all DataChunks belonging to a Project.
    """
    project_repo = ProjectRepository(db)
    chunk_repo = ChunkRepository(db)

    project = await project_repo.get_or_create(project_id)
    chunks = await chunk_repo.get_by_project(project_id, page=1, page_size=1000)

    if not chunks:
        raise HTTPException(status_code=404, detail="No document chunks found for this project.")

    success = await nlp.index_into_vector_db(project=project, chunks=list(chunks), do_reset=True)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to index documents into vector DB.")

    return {"status": "success", "message": f"Successfully indexed {len(chunks)} chunks."}


@router.post("/projects/{project_id}/chat", summary="Chat synchronously with the RAG agent")
async def chat(
    project_id: int,
    request: RAGQueryRequest,
    nlp: NLPOperationsDep,
):
    """
    Synchronous endpoint for general Q&A with the RAG agent.
    """
    trace = await nlp.execute_agent_query(
        session_id=request.session_id,
        project_id=project_id,
        query=request.query,
        action=AgentAction.ANSWER,
        limit=request.limit,
        stream=False,
    )

    if not trace.success:
        last_error = trace.steps[-1].error if trace.steps else "Unknown error"
        raise HTTPException(status_code=500, detail=last_error)

    return {"status": "success", "response": trace.final_answer}


@router.post("/projects/{project_id}/chat/stream", summary="Stream chat with the RAG agent")
async def chat_stream(
    project_id: int,
    request: RAGQueryRequest,
    nlp: NLPOperationsDep,
):
    """
    Streaming endpoint for general Q&A with the RAG agent.
    """
    trace = await nlp.execute_agent_query(
        session_id=request.session_id,
        project_id=project_id,
        query=request.query,
        action=AgentAction.ANSWER,
        limit=request.limit,
        stream=True,
    )

    if not trace.success or not trace.stream_generator:
        last_error = trace.steps[-1].error if trace.steps else "Unknown streaming error"
        raise HTTPException(status_code=500, detail=last_error)

    # Note: MemoryManager save logic for streaming must happen after consumption
    # We can handle it via a background task or by intercepting the generator.
    # For now, we return the generator directly.
    return StreamingResponse(trace.stream_generator, media_type="text/event-stream")


@router.post("/projects/{project_id}/summarize", summary="Generate a document summary")
async def summarize(
    project_id: int,
    request: RAGQueryRequest,
    nlp: NLPOperationsDep,
):
    """
    Endpoint to generate a summary based on the project documents.
    """
    trace = await nlp.execute_agent_query(
        session_id=request.session_id,
        project_id=project_id,
        query=request.query or "overview summary",
        action=AgentAction.SUMMARIZE,
        limit=request.limit,
        stream=False,
    )

    if not trace.success:
        last_error = trace.steps[-1].error if trace.steps else "Unknown error"
        raise HTTPException(status_code=500, detail=last_error)

    return {
        "status": "success",
        "summary": (
            trace.final_answer.get("summary")
            if isinstance(trace.final_answer, dict)
            else trace.final_answer
        ),
    }


@router.post("/projects/{project_id}/quiz", summary="Generate a quiz")
async def quiz(
    project_id: int,
    request: RAGQueryRequest,
    nlp: NLPOperationsDep,
):
    """
    Endpoint to generate a quiz based on the project documents.
    """
    trace = await nlp.execute_agent_query(
        session_id=request.session_id,
        project_id=project_id,
        query=request.query or "key concepts",
        action=AgentAction.QUIZ,
        limit=request.limit,
        stream=False,
    )

    if not trace.success:
        last_error = trace.steps[-1].error if trace.steps else "Unknown error"
        raise HTTPException(status_code=500, detail=last_error)

    return {
        "status": "success",
        "quiz": (
            trace.final_answer.get("quiz")
            if isinstance(trace.final_answer, dict)
            else trace.final_answer
        ),
    }
