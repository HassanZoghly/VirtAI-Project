# 🏗️ Final System Design — AI Chatbot Avatar RAG

> Compilation and refinement of all analyses into one comprehensive final design

-----

## 1. System Overview
```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT (React + Three.js)                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────────────┐   │
│  │   Auth   │  │   Chat   │  │   Voice   │  │   3D Avatar       │   │
│  │  Module  │  │  Module  │  │  Module   │  │ (GLB + Visemes)   │   │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └────────┬──────────┘   │
│       │             │              │                 │              │
│       ▼             ▼              ▼                 ▼              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              WebSocket Client + REST API Client              │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                    ══════════╪══════════  Network
                              │
┌─────────────────────────────┼───────────────────────────────────────┐
│                      API GATEWAY (FastAPI)                          │
│  ┌──────────────────────────┴───────────────────────────────────┐   │
│  │           Presentation Layer (HTTP + WebSocket)              │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                             │                                       │
│  ┌──────────────────────────┴───────────────────────────────────┐   │
│  │              Application Layer (Use Cases)                   │   │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌──────────────┐    │   │
│  │  │  Chat   │  │  Voice   │  │   RAG   │  │    Auth      │    │   │
│  │  │ UseCases│  │ UseCases │  │UseCases │  │  UseCases    │    │   │
│  │  └────┬────┘  └────┬─────┘  └────┬────┘  └──────────────┘    │   │
│  └───────┼────────────┼─────────────┼─────────────────────── ───┘   │
│          │            │             │                               │
│  ┌───────┴────────────┴─────────────┴──────────────────────────┐    │
│  │                   Domain Layer (Pure Logic)                 │    │
│  │  Entities │ Ports (Interfaces) │ Policies │ Value Objects   │    │
│  └───────┬────────────┬─────────────┬──────────────────────────┘    │
│          │            │             │                               │
│  ┌───────┴────────────┴─────────────┴──────────────────────────┐    │
│  │              Infrastructure Layer (Adapters)                │    │
│  │  ┌───────┐ ┌──────┐ ┌──────┐ ┌────────┐ ┌────────┐          │    │
│  │  │ Groq  │ │ Edge │ │FAISS │ │SQLite/ │ │ Redis  │          │    │
│  │  │Whisper│ │ TTS  │ │Qdrant│ │Postgres│ │(Cache) │          │    │
│  │  └───────┘ └──────┘ └──────┘ └────────┘ └────────┘          │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. The Golden Rule — Dependency Rule

```
Presentation  ──→  Application  ──→  Domain  ←──  Infrastructure
     │                  │               ▲               │
     │                  │               │               │
     ▼                  ▼               │               ▼
  (FastAPI,         (Use Cases,     (Entities,      (Groq, Edge,
   WebSocket)       Orchestration)   Ports,          FAISS, S3,
                                     Policies)       SQLAlchemy)
```

> **`Domain` knows nothing about the outside world**
> **`Infrastructure` implements the interfaces defined by `Domain`**

---

## 3. Backend Architecture — Final Structure

```
backend/
├── src/
│   └── app/
│       ├── main.py                           # App factory + lifespan
│       │
│       ├── presentation/                     # ← Transport Layer Only
│       │   ├── http/
│       │   │   └── v1/
│       │   │       ├── router.py             # Aggregates all routers
│       │   │       ├── dependencies.py       # DI for endpoints
│       │   │       └── endpoints/
│       │   │           ├── health.py
│       │   │           ├── auth.py
│       │   │           ├── sessions.py
│       │   │           ├── audio.py
│       │   │           └── rag_admin.py     # upload docs, check index
│       │   │
│       │   └── ws/
│       │       ├── gateway.py               # WS accept + dispatch (thin)
│       │       └── protocol.py              # Pydantic WS message types
│       │
│       ├── application/                     # ← Use Cases (Orchestration)
│       │   ├── chat/
│       │   │   ├── handle_text_turn.py      # text → RAG → LLM → response
│       │   │   └── stream_response.py       # streaming tokens
│       │   ├── voice/
│       │   │   ├── handle_voice_turn.py     # PCM → ASR → RAG → LLM → TTS
│       │   │   └── manage_stream.py         # start/stop/cancel
│       │   ├── rag/
│       │   │   ├── ingest_documents.py      # upload + chunk + embed + store
│       │   │   └── retrieve_context.py      # query → relevant chunks
│       │   └── auth/
│       │       └── authenticate.py
│       │
│       ├── domain/                          # ← Pure Business Logic
│       │   ├── chat/
│       │   │   ├── entities.py              # Message, Turn, Session
│       │   │   ├── ports.py                 # LLMPort, PromptBuilderPort
│       │   │   └── policies.py              # max_turns, safety_filter
│       │   ├── rag/
│       │   │   ├── entities.py              # DocumentChunk, Citation, Source
│       │   │   ├── ports.py                 # RetrieverPort, EmbedderPort, VectorStorePort
│       │   │   └── policies.py              # chunk_size, overlap, top_k
│       │   ├── voice/
│       │   │   ├── entities.py              # AudioFrame, VADState, VisemeTimeline
│       │   │   └── ports.py                 # ASRPort, TTSPort, VisemePort
│       │   └── user/
│       │       ├── entities.py              # User
│       │       └── ports.py                 # UserRepoPort
│       │
│       ├── infrastructure/                  # ← External Adapters
│       │   ├── asr/
│       │   │   ├── base.py                  # implements ASRPort
│       │   │   └── groq_whisper.py
│       │   ├── llm/
│       │   │   ├── base.py                  # implements LLMPort
│       │   │   ├── groq_provider.py
│       │   │   ├── prompt_builder.py
│       │   │   └── sentence_splitter.py
│       │   ├── tts/
│       │   │   ├── base.py                  # implements TTSPort
│       │   │   ├── edge_tts_provider.py
│       │   │   ├── tts_utils.py
│       │   │   ├── viseme_generator.py      # implements VisemePort
│       │   │   └── viseme_map.py
│       │   ├── rag/
│       │   │   ├── document_loaders.py      # PDF, URL, plain text parsers
│       │   │   ├── text_splitters.py        # chunking strategies
│       │   │   ├── embedding_provider.py    # HuggingFace / OpenAI embeddings
│       │   │   ├── faiss_store.py           # implements VectorStorePort (dev)
│       │   │   ├── qdrant_store.py          # implements VectorStorePort (prod)
│       │   │   └── reranker.py              # optional: cross-encoder reranking
│       │   ├── storage/
│       │   │   ├── local_audio.py           # dev: save to disk
│       │   │   └── s3_audio.py              # prod: save to S3
│       │   ├── db/
│       │   │   ├── database.py              # engine + session factory
│       │   │   ├── models.py                # SQLAlchemy ORM models
│       │   │   └── repositories.py          # implements UserRepoPort
│       │   └── cache/
│       │       └── redis_client.py          # session cache, rate limiting
│       │
│       ├── schemas/                         # Pydantic DTOs (shared)
│       │   ├── auth.py
│       │   ├── chat.py
│       │   ├── audio.py
│       │   ├── rag.py
│       │   └── ws_messages.py
│       │
│       └── shared/                          # Cross-cutting concerns
│           ├── config.py                    # pydantic Settings
│           ├── errors.py                    # custom exceptions
│           ├── logging.py                   # structured JSON logging
│           └── security.py                  # JWT, hashing
│
├── tests/
│   ├── unit/
│   │   ├── domain/                          # test pure logic
│   │   └── application/                     # test use cases with mocks
│   ├── integration/
│   │   ├── infrastructure/                  # test real DB/API calls
│   │   └── presentation/                    # test endpoints
│   └── conftest.py
│
├── scripts/
│   ├── ingest_documents.py                  # CLI: index docs into vector DB
│   └── generate_voice_previews.py
│
├── pyproject.toml
├── requirements.txt
└── .env.example
```

---

## 4. RAG Pipeline — Detailed Design

### 4.1 Ingestion Flow (Offline / CLI)

```
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐
│  Source  │───→│  Loader  │───→│  Splitter │───→│ Embedder │───→│ Vector   │
│ (PDF/URL │    │ (Parse)  │    │ (Chunk)   │    │ (Encode) │    │   Store  │
│  /Text)  │    │          │    │           │    │          │    │ (FAISS/  │
│          │    │          │    │ +metadata │    │          │    │ Qdrant)  │
└──────────┘    └──────────┘    └───────────┘    └──────────┘    └──────────┘
```

```python
# domain/rag/ports.py  — Interfaces only
from abc import ABC, abstractmethod

class EmbedderPort(ABC):
    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        ...

class VectorStorePort(ABC):
    @abstractmethod
    async def add(self, chunks: list[DocumentChunk]) -> None:
        ...

    @abstractmethod
    async def search(self, query_vector: list[float], top_k: int) -> list[DocumentChunk]:
        ...

class RetrieverPort(ABC):
    @abstractmethod
    async def retrieve(self, query: str, top_k: int = 5) -> list[DocumentChunk]:
        ...
```

### 4.2 Runtime Query Flow (Online)

```
User Question
      │
      ▼
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Embedder  │────→│  Vector DB   │────→│   Reranker      │
│  (encode    │     │  (similarity │     │  (cross-encoder │
│   query)    │     │   search)    │     │   scoring)      │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                                          Top-K Chunks
                                                   │
                                                   ▼
                                         ┌─────────────────┐
                                         │ Prompt Builder  │
                                         │ (question +     │
                                         │  context +      │
                                         │  system prompt) │
                                         └────────┬────────┘
                                                  │
                                                  ▼
                                         ┌─────────────────┐
                                         │      LLM        │
                                         │  (generate      │
                                         │   answer)       │
                                         └─────────────────┘
```

### 4.3 RAG in Full Context (Voice Mode)

```python
# application/voice/handle_voice_turn.py
class HandleVoiceTurn:
    def __init__(
        self,
        asr: ASRPort,
        retriever: RetrieverPort,
        llm: LLMPort,
        tts: TTSPort,
        viseme: VisemePort,
    ):
        self.asr = asr
        self.retriever = retriever
        self.llm = llm
        self.tts = tts
        self.viseme = viseme

    async def execute(self, audio_bytes: bytes, session: Session):
        # Step 1: Speech → Text
        transcript = await self.asr.transcribe(audio_bytes)

        # Step 2: Retrieve relevant context (RAG)
        chunks = await self.retriever.retrieve(transcript, top_k=5)
        context = "\n".join(c.text for c in chunks)

        # Step 3: Build prompt with context
        prompt = self._build_prompt(transcript, context, session.history)

        # Step 4: Generate response (streaming)
        full_response = ""
        async for token in self.llm.stream(prompt):
            full_response += token
            yield {"type": "assistant.token", "data": token}

        # Step 5: Text → Speech + Visemes
        audio_url = await self.tts.synthesize(full_response)
        visemes = await self.viseme.generate(full_response)

        yield {
            "type": "assistant.audio",
            "data": {"url": audio_url, "visemes": visemes}
        }
```

---

## 5. WebSocket Protocol — Clean Design

```python
# presentation/ws/protocol.py
from pydantic import BaseModel
from typing import Literal
from enum import Enum

# ── Client → Server ──────────────────────────────

class ClientAudioFrame(BaseModel):
    type: Literal["client.audio_frame"]
    audio_b64: str          # base64 PCM
    seq: int
    timestamp: float

class ClientTextMessage(BaseModel):
    type: Literal["client.text_message"]
    text: str
    session_id: str

class ClientEvent(BaseModel):
    type: Literal["client.event"]
    event: Literal["start", "stop", "cancel", "interrupt"]

# ── Server → Client ──────────────────────────────

class ServerASRPartial(BaseModel):
    type: Literal["server.asr_partial"]
    text: str

class ServerASRFinal(BaseModel):
    type: Literal["server.asr_final"]
    text: str

class ServerAssistantToken(BaseModel):
    type: Literal["server.assistant_token"]
    token: str

class ServerAssistantFinal(BaseModel):
    type: Literal["server.assistant_final"]
    text: str
    citations: list[dict] = []    # RAG sources

class ServerTTSAudio(BaseModel):
    type: Literal["server.tts_audio"]
    audio_url: str
    visemes: list[dict]           # [{time, value, duration}]

class ServerError(BaseModel):
    type: Literal["server.error"]
    code: str
    message: str
```

```python
# presentation/ws/gateway.py — Thin Handler
async def voice_gateway(ws: WebSocket, use_case: HandleVoiceTurn = Depends()):
    await ws.accept()
    try:
        async for raw in ws.iter_json():
            msg_type = raw.get("type")

            if msg_type == "client.audio_frame":
                frame = ClientAudioFrame(**raw)
                async for event in use_case.execute(frame):
                    await ws.send_json(event)

            elif msg_type == "client.text_message":
                msg = ClientTextMessage(**raw)
                async for event in use_case.handle_text(msg):
                    await ws.send_json(event)

            elif msg_type == "client.event":
                event = ClientEvent(**raw)
                await use_case.handle_event(event)
    except WebSocketDisconnect:
        await use_case.cleanup()
```

---

## 6. Frontend Architecture — Final Structure

```
frontend/
├── src/
│   ├── app/                              # App-level setup
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── routes.jsx                    # React Router config
│   │   └── main.jsx
│   │
│   ├── pages/                            # Routes ONLY (thin wrappers)
│   │   ├── OverviewPage.jsx              # → <OverviewWidget />
│   │   ├── AuthPage.jsx                  # → <AuthFeature />
│   │   ├── SetupPage.jsx                 # → <SetupFeature />
│   │   ├── ClassroomPage.jsx             # → <ClassroomWidget />
│   │   └── NotFoundPage.jsx
│   │
│   ├── features/                         # Self-contained feature modules
│   │   ├── auth/
│   │   │   ├── components/
│   │   │   │   ├── LoginForm.jsx
│   │   │   │   ├── SignupForm.jsx
│   │   │   │   ├── GoogleAuthButton.jsx
│   │   │   │   ├── PasswordStrength.jsx
│   │   │   │   └── WelcomePanel.jsx
│   │   │   ├── hooks/
│   │   │   │   └── useAuth.js
│   │   │   ├── services/
│   │   │   │   └── authApi.js
│   │   │   ├── store/
│   │   │   │   └── authStore.js          # Zustand
│   │   │   └── index.js                  # public API of feature
│   │   │
│   │   ├── avatar/                       # ← ALL avatar logic here
│   │   │   ├── components/
│   │   │   │   ├── AvatarPanel.jsx       # avatar selection UI
│   │   │   │   ├── AvatarScene.jsx       # Three.js Canvas + model
│   │   │   │   ├── AvatarRig.jsx         # ← extracted: bone/mesh setup
│   │   │   │   └── AvatarController.jsx  # ← moved from pages/
│   │   │   ├── hooks/
│   │   │   │   ├── useAnimationClips.js  # ← extracted: load FBX clips
│   │   │   │   ├── useAnimationQueue.js  # ← extracted: queue management
│   │   │   │   ├── useMorphTargets.js    # ← extracted: morph target control
│   │   │   │   ├── useHeadMotion.js      # ← extracted: idle head movement
│   │   │   │   ├── useAudioPlayer.js     # ← extracted: audio playback
│   │   │   │   ├── useAudioDrivenLipSync.js
│   │   │   │   └── useRealismEnhancements.js
│   │   │   ├── AvatarFaceController.js
│   │   │   ├── constants.js
│   │   │   └── index.js
│   │   │
│   │   ├── chat/
│   │   │   ├── components/
│   │   │   │   ├── ChatInput.jsx
│   │   │   │   ├── MessageBubble.jsx
│   │   │   │   └── MessageList.jsx
│   │   │   ├── store/
│   │   │   │   └── conversationStore.js  # ← moved from useConversationReducer
│   │   │   └── index.js
│   │   │
│   │   ├── voice/
│   │   │   ├── audio/
│   │   │   │   ├── circularBuffer.ts
│   │   │   │   ├── pcmRecorder.ts
│   │   │   │   ├── pcmWorklet.js
│   │   │   │   ├── vad.ts
│   │   │   │   └── vad.worker.ts
│   │   │   ├── components/
│   │   │   │   └── VoiceModeButton.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useMicrophoneStream.ts
│   │   │   │   ├── useRealtimeASR.ts
│   │   │   │   └── useVoiceMode.ts
│   │   │   └── index.js
│   │   │
│   │   ├── session/
│   │   │   ├── components/
│   │   │   │   ├── RenameModal.jsx
│   │   │   │   ├── SessionList.jsx
│   │   │   │   └── SettingsDrawer.jsx
│   │   │   ├── hooks/
│   │   │   │   └── useSessionManager.js
│   │   │   ├── services/
│   │   │   │   └── sessionStorage.js
│   │   │   └── index.js
│   │   │
│   │   └── setup/
│   │       ├── components/
│   │       │   ├── AvatarTab.jsx
│   │       │   ├── VoiceTab.jsx
│   │       │   ├── AllSetTab.jsx
│   │       │   └── AvatarPreview.jsx
│   │       ├── services/
│   │       │   └── setupStorage.js
│   │       └── index.js
│   │
│   ├── widgets/                          # ← Compose features together
│   │   ├── Classroom/
│   │   │   ├── ClassroomShell.jsx        # orchestrates avatar+voice+chat
│   │   │   └── Classroom.css
│   │   └── Overview/
│   │       ├── HeroSection.jsx
│   │       ├── FeaturesSection.jsx
│   │       ├── HowItWorks.jsx
│   │       ├── TechStackSection.jsx
│   │       ├── DemoPreview.jsx
│   │       ├── Footer.jsx
│   │       └── Navbar.jsx
│   │
│   └── shared/                           # Zero feature knowledge
│       ├── ws/
│       │   ├── wsClient.js               # raw WebSocket wrapper
│       │   └── protocol.js               # message type constants
│       ├── stores/
│       │   └── wsStore.js                # ← Zustand: connection state
│       ├── components/
│       │   ├── CopyButton.jsx
│       │   └── ProtectedRoute.jsx
│       ├── hooks/
│       │   └── useEventBus.js
│       ├── services/
│       │   └── apiClient.js
│       ├── ui/
│       │   ├── AnimatedShinyButton.jsx
│       │   ├── CardHoverEffect.jsx
│       │   └── CircuitLines.jsx
│       └── utils/
│           ├── cn.js
│           ├── logger.js
│           └── toast.js
│
├── public/
│   ├── assets/
│   ├── audio/
│   ├── models/
│   └── manifest.json
│
├── package.json
├── vite.config.js
└── vitest.config.js
```

---

## 7. Frontend Dependency Rules

```
                    ┌──────────┐
                    │   app/   │  imports only from pages
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │  pages/  │  imports from widgets + features
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │ widgets/ │  imports from features + shared
                    └────┬─────┘
                         │
                    ┌────▼──────┐
                    │ features/ │  imports only from shared
                    └────┬──────┘   ⚠️ feature must not import from another feature
                         │
                    ┌────▼─────┐
                    │ shared/  │  imports from no higher layer
                    └──────────┘
```

---

## 8. State Management — Centralized Stores

```javascript
// shared/stores/wsStore.js — WebSocket State
import { create } from 'zustand';

export const useWSStore = create((set, get) => ({
  socket: null,
  status: 'disconnected', // connecting | connected | disconnected | error

  connect: (url, token) => {
    const ws = new WebSocket(`${url}?token=${token}`);
    ws.onopen = () => set({ status: 'connected', socket: ws });
    ws.onclose = () => set({ status: 'disconnected', socket: null });
    ws.onerror = () => set({ status: 'error' });
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      // delegate to feature stores based on msg.type
      get().dispatch(msg);
    };
    set({ socket: ws, status: 'connecting' });
  },

  send: (msg) => {
    const { socket } = get();
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  },

  // subscriber pattern - features register handlers
  _handlers: new Map(),
  on: (type, handler) => {
    get()._handlers.set(type, handler);
  },
  dispatch: (msg) => {
    const handler = get()._handlers.get(msg.type);
    if (handler) handler(msg);
  },
}));
```

```javascript
// features/chat/store/conversationStore.js
import { create } from 'zustand';
import { useWSStore } from '@/shared/stores/wsStore';

export const useConversationStore = create((set, get) => ({
  messages: [],
  isStreaming: false,
  currentStreamText: '',

  init: () => {
    const ws = useWSStore.getState();
    ws.on('server.assistant_token', (msg) => {
      set(s => ({ currentStreamText: s.currentStreamText + msg.token, isStreaming: true }));
    });
    ws.on('server.assistant_final', (msg) => {
      set(s => ({
        messages: [...s.messages, { role: 'assistant', text: msg.text, citations: msg.citations }],
        currentStreamText: '',
        isStreaming: false,
      }));
    });
  },

  sendMessage: (text, sessionId) => {
    set(s => ({ messages: [...s.messages, { role: 'user', text }] }));
    useWSStore.getState().send({
      type: 'client.text_message',
      text,
      session_id: sessionId,
    });
  },
}));
```

---

## 9. Scalability Checklist

```
┌────────────────────────────────────────────────────────────────────┐
│                    SCALABILITY CHECKLIST                           │
├──────────────────────┬─────────────────────────────────────────────┤
│ Concern              │ Solution                                    │
├──────────────────────┼─────────────────────────────────────────────┤
│ Session state in RAM │ → Redis (session cache + pub/sub)           │
│ Audio file storage   │ → AudioStorePort (Local → S3)               │
│ Vector DB scaling    │ → VectorStorePort (FAISS → Qdrant)          │
│ LLM provider lock-in │ → LLMPort interface (Groq → OpenAI → local) │
│ WS single instance   │ → Redis pub/sub for multi-instance          │
│ DB scaling           │ → SQLite → PostgreSQL (same ORM)            │
│ Monitoring           │ → Structured JSON logs + correlation ID     │
│ RAG evaluation       │ → MLflow / Ragas metrics tracking           │
│ Feature coupling     │ → Feature isolation via shared/ + widgets   │
│ Test coverage        │ → Unit (domain) + Integration (infra)       │
└──────────────────────┴─────────────────────────────────────────────┘
```

---

## 10. Docker Compose — Development Setup

```yaml
# docker-compose.yml
version: '3.9'

services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    env_file: ./backend/.env
    volumes:
      - ./backend/src:/app/src
      - audio-data:/app/audio_files
    depends_on:
      - redis
      - qdrant

  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    volumes:
      - ./frontend/src:/app/src

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant-data:/qdrant/storage

volumes:
  audio-data:
  qdrant-data:
```

---

## 11. Migration Priority — Execution Plan

```
Phase 1: Backend Restructure 
  ├── Create domain/ports.py for each service
  ├── Move services/* → infrastructure/*
  ├── Create application/use_cases
  └── Move websocket handler → presentation/ws/gateway.py

Phase 2: RAG Pipeline
  ├── domain/rag/entities.py + ports.py
  ├── infrastructure/rag/* (loader, splitter, embedder, store)
  ├── application/rag/ingest + retrieve
  └── scripts/ingest_documents.py

Phase 3: Frontend Cleanup
  ├── Move avatar components → features/avatar/
  ├── Create widgets/Classroom/
  ├── Create shared/stores/wsStore.js
  └── pages = thin wrappers only

Phase 4: Testing & Observability
  ├── unit tests for domain layer
  ├── integration tests for infrastructure
  └── structured logging + correlation IDs
```

---

## 12. Summary of Final Decisions

| Decision | Choice | Reason |
|---|---|---|
| **Architecture Pattern** | Hexagonal (Ports & Adapters) | Easier to swap providers and cleaner for testing |
| **Backend Structure** | presentation → application → domain ← infrastructure | Complete separation between business logic and external world |
| **Frontend Structure** | Feature-Sliced Design + Widgets | Each feature isolated, widgets compose them |
| **State Management** | Zustand (multiple stores) | Lightweight, simple, no boilerplate |
| **WS Design** | Thin Gateway + Protocol types | Gateway contains no business logic |
| **RAG** | Dedicated domain + infrastructure module | Ready for expansion and evaluation |
| **Pages** | Routes only | No components or logic — import only |
| **Testing** | Domain (unit) + Infra (integration) | Highest ROI in coverage |

> **Result**: A project ready for scaling, easy to maintain, and every component independently replaceable 🚀
