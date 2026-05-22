from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4
from enum import Enum


@dataclass
class Document:
    id: UUID | None
    user_id: UUID
    filename: str
    file_type: str
    upload_date: datetime
    chunk_count: int
    status: str  # processing, ready, failed


@dataclass
class DocumentChunk:
    id: UUID | None
    document_id: UUID
    chunk_text: str
    chunk_order: int
    embedding: list[float] | None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    chunk_version: int = 1
    is_active: bool = True
    retrieval_scope: str = "GLOBAL"
    scope_id: UUID | None = None


class AgentAction(str, Enum):
    RETRIEVE = "retrieve"
    ANSWER = "answer"
    SUMMARIZE = "summarize"
    QUIZ = "quiz"
    SEARCH = "search"
    UNKNOWN = "unknown"


@dataclass
class AgentInput:
    query: str
    project_id: int
    input_id: str = field(default_factory=lambda: str(uuid4()))
    action: AgentAction = AgentAction.ANSWER
    limit: int = 5
    stream: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class AgentOutput:
    input_id: str
    agent_name: str
    output_id: str = field(default_factory=lambda: str(uuid4()))
    success: bool = True
    result: Any = None
    stream_generator: Any = None
    error: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class AgentTrace:
    input_id: str
    query: str
    project_id: int
    trace_id: str = field(default_factory=lambda: str(uuid4()))
    steps: list[AgentOutput] = field(default_factory=list)
    final_answer: Any = None
    stream_generator: Any = None
    success: bool = True
    created_at: datetime = field(default_factory=datetime.utcnow)

    def add_step(self, output: AgentOutput) -> None:
        self.steps.append(output)

    def last_result(self) -> Any:
        if self.steps:
            return self.steps[-1].result
        return None


@dataclass
class MemoryEntry:
    session_id: str
    role: str  # "user" | "assistant"
    content: str
    entry_id: str = field(default_factory=lambda: str(uuid4()))
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class RetrievedDocument:
    text: str
    score: float
    metadata: dict[str, Any] = field(default_factory=dict)
    id: str | None = None
