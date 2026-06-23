# VirtAI Architecture Documentation

## Overview
VirtAI follows a clean **Ports and Adapters** (Hexagonal) Architecture to isolate core domain logic from external dependencies (frameworks, LLMs, external APIs, and DBs).

## Ports and Adapters
The architecture guarantees that business rules (`app/domain`) and Use Cases (`app/application`) do not depend on external systems (`app/infrastructure` or `app/presentation`).

```mermaid
graph TD
    subgraph Presentation ["Presentation Layer (HTTP / WebSockets)"]
        Router[API Routers]
        WSEndpoint[WebSocket Handlers]
    end

    subgraph Application ["Application Layer (Use Cases)"]
        ChatUC[ChatUseCase]
        SummaryUC[SummaryUseCase]
        QuizUC[QuizUseCase]
        ExplainWS[ExplainHandler]
    end

    subgraph Domain ["Domain Layer (Core Logic & Ports)"]
        TaskTypes[Task Type & Locale]
        ExplainState[PresentationState Enums]
        Ports[Interfaces: DBPort, LLMPort, etc.]
    end

    subgraph Infrastructure ["Infrastructure Layer (Adapters)"]
        PGVector[PGVector Store]
        Groq[Groq LLM Client]
        Napkin[Napkin API Client]
    end

    Presentation --> Application
    Application --> Domain
    Infrastructure -->|Implements| Ports
    Application --> Ports
```

## Map-Reduce Summary Flow
The `SummaryUseCase` is responsible for parsing large documents without exhausting LLM rate limits or context windows, achieving this via an Async Map-Reduce architecture governed by `asyncio.Semaphore(3)`.

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant SummaryUseCase
    participant DB
    participant LLM

    Client->>API: POST /summarize/{document_id}
    API->>DB: Fetch Document Chunks
    DB-->>API: List of Chunks
    API->>SummaryUseCase: execute(chunks)
    
    note over SummaryUseCase: MAP Phase (Concurrency: 3)
    SummaryUseCase->>LLM: Summarize Chunk 1
    SummaryUseCase->>LLM: Summarize Chunk 2
    SummaryUseCase->>LLM: Summarize Chunk 3
    LLM-->>SummaryUseCase: Partial Summaries
    
    note over SummaryUseCase: REDUCE Phase
    SummaryUseCase->>LLM: Combine Partial Summaries
    LLM-->>SummaryUseCase: Streaming Final Summary
    
    SummaryUseCase-->>Client: SSE Stream Yield (Chunk)
    SummaryUseCase->>DB: Cache Final Summary (async)
```

## WebSocket State Machine (Explain Mode)
The "Slide-by-Slide Explain Mode" utilizes a persistent server-side State Machine to stream documents, intercept questions mid-presentation, and resume flawlessly.

```mermaid
stateDiagram-v2
    [*] --> EXPLAINING : SlideStartEvent
    
    EXPLAINING --> EXPLAINING : SlideContentTokens (Simulated TTS)
    EXPLAINING --> AWAITING : SlideEndEvent
    EXPLAINING --> ANSWERING : User Interrupts (Pause/Question)
    
    AWAITING --> EXPLAINING : User sends "Continue" (Current Index + 1)
    AWAITING --> ANSWERING : User asks Question
    
    ANSWERING --> AWAITING : LLM Answer Stream Finished
```

## The Sentinel Pattern (Graceful Degradation)
To protect the frontend User Experience from unhandled 500 crashes due to external API failures (e.g., Napkin API quotas), we employ the **Sentinel Pattern**. 

Instead of raising exceptions when an external service fails, the Adapter returns a safe, controlled JSON envelope:
```json
{
  "unavailable": true,
  "reason": "quota_exceeded"
}
```
The Frontend UI consumes this payload and gracefully renders a localized `toast.error`, or hides the UI trigger entirely if `reason === "not_configured"`.
