I have a complete picture now. Let me deliver the final refactor plan organized by batches, following the user’s preferred style: executive summary first, then detailed batches ordered from lowest-coupling cleanup to highest-impact refactors.

---

# Full Refactor Plan for VirtAI Backend

## 🎯 The Bottom Line (Executive Summary)

The backend **architecture is fundamentally sound** — Clean Architecture with 4 clear layers (Presentation / Application / Domain / Infrastructure) + real Ports & Adapters. **No need for a rewrite from scratch**. **Pragmatic improvement, not theoretical clean code**.

There are **5 real problems** we need to solve in this order:

| #   | Problem                                                                                                                                                   | Severity | Effort |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| 1   | **Dead code & legacy shims** (rag_prompts.py, duplicate chunkers, ab_runner, migrations 0618aecd13e3+e4)                                                 | Low      | Small  |
| 2   | **God Objects**: AnimationIntelligenceService, VoiceModeHandler, gateway.py, DocumentRepository, PromptSanitizer buried in entities.py                   | High     | Medium |
| 3   | **Layer leaks**: explain_handler holds in-memory state, documents.py has direct file I/O + db.commit() in endpoint, chat.py has LLM prompts              | High     | Medium |
| 4   | **Typing debt**: `dict[str, Any]` in WS envelopes, repositories returning `dict` instead of TypedDict/Entity, dual modern/legacy protocol                | Medium   | Medium |
| 5   | **Reliability gaps**: dummy fallbacks masking failures (DummyCrossEncoder, viseme silent fail), brittle JSON in Quiz/Diagram, duplicated `_INTENT_KEYWORDS` | High     | Large  |

The rest (DI container, more abstractions, etc.) are **overengineering** and the reviewer himself warns against them.

---

## 📦 Batches (ordered from lowest-coupling to highest-coupling — following your audit style)

### **PATCH 1 — Dead Code Purge** _(zero risk)_

Files **1000% to be deleted or merged**:

1. **`infrastructure/rag/rag_prompts.py`** — explicitly marked as “Deprecated backwards-compatibility shim”. Delete it entirely and migrate all imports to `infrastructure/rag/prompts/registry`.
2. **`infrastructure/rag/ab_runner.py`** — A/B shadow testing between legacy and new RAG paths. Migration is complete → delete the entire legacy path.
3. **`infrastructure/rag/markdown_chunker.py` VS `smart_chunker.py`** — Choose one. `smart_chunker` is newer and smarter → adopt it and delete the old one. Update `IngestDocumentUseCase` to use only `smart_chunker`.
4. **Migrations duplicates**:
    - `0618aecd13e3_enforce_unique_document_sha256.py` and `0618aecd13e4_refactor_unique_document_sha256.py` — both for the same constraint. Merge into one new migration or mark the old one as no-op.
5. **`DummyCrossEncoderReranker`** — If the CrossEncoder import fails, **fail fast** instead of giving a dummy. The reviewer says `fallbacks should never mask bugs`.
6. **Unused legacy WS protocol** in `schemas/ws_messages.py` — `ServerMessage` and `ClientMessageType` Enums. If the frontend isn't using them yet, delete the legacy branch from `ProtocolRouter` and `OutboundSender`.

**Acceptance**: all pytest passes, Playwright E2E quiz/diagram/explain passes, ingestion pipeline finishes one PDF successfully.

---

### **PATCH 2 — God Object Splitting (Application Layer)**

Ordered from simplest to hardest:

#### 2.1 `application/animation/intelligence_service.py` → split into 4 files

```
animation/
├── intent_scorer.py        # text → intent_scores (softmax + single centralized _INTENT_KEYWORDS)
├── audio_feature_fuser.py  # audio + intent → energy/emphasis fusion
├── profile_selector.py     # gesture affinity + softmax selection
└── timeline_builder.py     # final v1/v2 timeline assembly
intelligence_service.py     # thin orchestrator (only 50-80 lines)
```

- Remove duplicated `_INTENT_KEYWORDS` in `animation_mapper.py` and import it from `intent_scorer.py`.
- **Remove** the code `Path(__file__).resolve().parents[4] / "frontend"` — this is a complete violation of layer boundaries. Asset discovery should come from config or DB.

#### 2.2 `application/voice/handle_voice_turn.py` (`ConversationPipeline`)

Currently does LLM + TTS + Animation + Filler + DB persistence + state reporting. Split:

```
voice/
├── handle_voice_turn.py    # orchestrator only (TaskGroup)
├── filler_coordinator.py   # all "Hmm..." logic (Redis cache + 400ms gate)
├── turn_persistence.py     # save messages to DB
└── pipeline_stages.py      # exists — just extend it to include a real AnimationStage
```

#### 2.3 `domain/chat/entities.py` contains `PromptSanitizer`

This is a **major violation**. The sanitizer is all regex/security logic and is not an entity. Move it to:

```
shared/security/prompt_sanitizer.py
```

Leave only dataclasses in `entities.py` (`ConversationHistory`, `LLMChunk`, `LLMResult`).

---

### **PATCH 3 — Presentation Layer Cleanup (Layer Leak Fix)**

This is the patch that **fixes the most real architectural issues**:

#### 3.1 `presentation/ws/explain_handler.py`

- The `_explain_sessions_cache` (in-memory dict) **must be moved** to Redis or DB. Currently, if the pod restarts, presentation state is lost.
- Make the handler thin: receives event → sends to `ExplainUseCase` → sends result to client.
- Remove `_presentation_loop` with `asyncio.sleep(0.1)` simulating TTS streaming — that belongs in the application layer.

#### 3.2 `presentation/http/v1/endpoints/documents.py`

- Remove `aiofiles.os.makedirs` and direct file writes → all go to `StorageProvider` adapter.
- Remove `await db.commit()` and `db.rollback()` → `IngestDocumentUseCase` manages the transaction boundary.
- "Stale ingestion" logic (timedelta checks, IngestionStage transitions) → move to `application/rag/ingest_document.py`.

#### 3.3 `presentation/http/v1/endpoints/chat.py` → `generate_session_title`

- The `system_prompt` and `_clean_generated_title` → create `GenerateTitleUseCase` in `application/chat/`.
- The endpoint should be only 5 lines.

#### 3.4 `presentation/ws/gateway.py` (WebSocketHandler) and `voice_mode_handler.py`

- Split `WebSocketHandler` into:
  - `connection_lifecycle.py` (heartbeat, pong, cleanup)
  - `frame_dispatcher.py` (binary vs JSON routing)
  - `gateway.py` (orchestrator only)
- `VoiceModeHandler` — move VAD logic and rate limiting to infrastructure (`infrastructure/asr/audio_pipeline.py` exists — extend it). The handler remains thin.

---

### **PATCH 4 — Repository & Type Hygiene**

#### 4.1 `infrastructure/db/repositories/document_repository.py`

Split into:

- `document_crud_repository.py` — basic CRUD
- `ingestion_state_repository.py` — state machine transitions, chunk versioning, atomic activation
- `document_integrity_service.py` — embedding count checks, order gaps (this is a service, not a repo)

#### 4.2 Typing improvements (targeted, not wholesale)

- `repositories/*.py` — change `_serialize() → dict` to return `TypedDict` or return `UserEntity`/`ChatSessionEntity` directly.
- `schemas/ws_messages.py` — reduce `dict[str, Any]` in `WSMessageEnvelope.data` using discriminated union on the `type` field.
- `ChatRepository.save_message(sources: list[dict])` → `list[Citation]` (Citation already exists in `domain/rag/citation.py`).
- Tools: `mypy --strict` on `app/domain/` and `app/application/` (infrastructure can still have leniency for provider SDKs).

#### 4.3 Migrations cleanup

- Create one migration that merges all changes from 001 to 003 into a new baseline if possible (squash).
- If not possible (production data) → keep history and add a `README.md` in `alembic/versions/` clarifying the legacy timeline.

---

### **PATCH 5 — Reliability & Error Handling** _(the most important patch)_

#### 5.1 Brittle JSON in `QuizUseCase` and `DiagramUseCase`

- Instead of retry-and-pray, use **direct structured output APIs**:
  - OpenAI: `response_format={"type": "json_schema", ...}`
  - Groq: tool/function calling
- If the provider doesn't support it → have a clear schema validation step + return an informative Sentinel envelope to the frontend (not 500).

#### 5.2 Silent failures

- `VisemeGenerator` when `numpy`/`pydub` are missing returns `[]` — change to explicit error at startup. If deps exist → feature works. If not → log warning once and set `viseme_disabled=True` in session state instead of hiding silently.
- `DummyCrossEncoderReranker` — removed in Patch 1. If the reranker is missing → the retrieval pipeline proceeds without reranking **explicitly** (config flag).

#### 5.3 Cancellation safety in voice pipeline

- When the user interrupts, ensure:
  - TTS task → actually `cancel()`
  - LLM streaming → HTTP connection is closed
  - Animation timeline → gets cleared
- Add integration test simulating interruption at each stage.

#### 5.4 Auth fail-closed gotcha

- Refresh token validation fails-closed if Redis is down — the reviewer warned about it. Have strong **alerting** on Redis health + maybe a “grace mode” for 60 seconds if Redis suddenly goes down.

#### 5.5 Standardize error envelope across all features

All HTTP errors should return:

```json
{"error": {"code": "QUIZ_GENERATION_FAILED", "message": "...", "retryable": false, "details": {}}}
```

Add middleware `error_envelope_middleware.py` in `shared/`.

---

### **PATCH 6 — Caching Consistency (optional but useful)**

- Unify the 4 caches (Summary, Diagram, Visualization, Quiz) under a single `CachePort` in `domain/caching/ports.py` + adapters for each.
- Add a clear **invalidation policy**: if a document is updated → clear all cached summaries/diagrams/quizzes for it. Currently there is no invalidation strategy.
- Move the duplicated `_INTENT_KEYWORDS` to `domain/animation/intent_definitions.py` (single source of truth).

---

### **PATCH 7 — Testing Hardening** _(preferably after each patch)_

- After each Patch, ensure:
  - Load test (Locust) still has p95 < 2.3s for 50 concurrent users.
  - Playwright E2E full flow passes.
  - mypy on `domain/` and `application/` is clean.
- Add:
  - Contract tests on the ports (chaos: ASR returns timeout, TTS returns 5xx, LLM throws malformed JSON).
  - WebSocket reconnection/replay test (random sequence + missed frames).

---

## 🚫 Things we **will NOT do** (overengineering per the reviewer himself)

- ❌ DI container (punq/dependency-injector) — FastAPI native + `app.state` are enough.
- ❌ Repositories for trivial CRUD.
- ❌ New Strategy/Factory patterns without a clear use case.
- ❌ One big migration of the legacy WS protocol — keep it gradual.
- ❌ Changing public API contracts or WS event names.
- ❌ Microservices split — no need.

---

## 📋 Proposed Execution Order

```
Patch 1 (Dead Code) + Patch 2.1 (Animation split)
Patch 2.2 + 2.3 + Patch 3.1, 3.2 (the most important layer leaks)
Patch 3.3, 3.4 + Patch 4 (Repos + Typing)
Patch 5 (Reliability — most important)
Patch 6 + 7 (Caching + Testing)
```

After each patch: **independent PR**, mypy clean, tests green, commit with a clear scope (`refactor(animation): split intelligence_service into 4 modules`).

---

### Strong Suggestions Often Mentioned

These can be considered problems or valuable improvements, provided the implementation is reviewed:

- Separating business logic from endpoints.
- Preventing direct DB/file I/O from the presentation layer.
- Improving error handling.
- Testing malformed quiz JSON.
- Testing Mermaid validation.
- Testing voice interruption.
- Testing WebSocket reconnect/disconnect.
- Ownership checks for every document flow.
- Not leaking API keys in logs.
- Preventing misleading silent fallbacks.
- Improving typed boundaries in WebSocket/API.

These are logical suggestions even if implementation details need review.

Suggestions that are not “wrong”, but should not be implemented before verification

| Suggestion                                                                                         | Why it needs verification                                                                                           |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Delete legacy protocol                                                                             | May be used by frontend, tests, or for compatibility                                                                |
| Delete old chunker                                                                                 | May serve a different document type or legacy stored chunks                                                         |
| Squash/delete migrations                                                                           | May break existing databases or CI/CD                                                                               |
| Move state to Redis                                                                                | Depends on deployment, number of workers, and durability requirements                                               |
| Unify all caches                                                                                   | The abstraction may not be useful                                                                                   |
| Split every repository                                                                             | May increase files without solving a real problem                                                                   |
| Enforce JSON schema on every LLM flow                                                              | May create brittleness or provider lock-in                                                                          |
| Grace mode for refresh token when Redis is down                                                    | May be a security risk                                                                                              |
| Fixed performance target                                                                           | Not valid without a baseline and a standard environment                                                             |

Execute only after proving for each Patch:

1. Where exactly is the problem?
2. What are the call sites?
3. Is there a test or frontend dependency?
4. What is the regression risk?
5. What is the smallest change that solves the problem?
6. Is there a migration/API/WebSocket compatibility impact?

Verification Before Refactor:
No code may be modified, and for each recommendation, it is required to provide:

- exact files/functions
- imports and call sites
- runtime/config references
- frontend/API/WebSocket dependencies
- test coverage
- migration/deployment impact
- confidence level
- safe / unsafe to implement now
- minimal patch plan
