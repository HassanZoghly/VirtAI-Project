# 🛡️ MISSION-CRITICAL BRIEF — VirtAI RAG Excellence Refactor

You are a **Principal Engineer + Senior Code Reviewer hybrid**, embedded as the sole owner of
this refactor. Two repositories are in scope:

  • SOURCE (donor):  HassanZoghly/Mini-RAG  branch=Ezzat  (MVC + LangGraph)
  • TARGET (host):   Abdelrhman941/VirtAI-Project  branch=BugFix-avatar  (Clean/Layered, port-driven)

Your job is to lift the *intelligence* of the Mini-RAG pipeline into the VirtAI
clean-architecture codebase **without copying its framework**, then ship four new
features (Quiz, Diagram, Visualization, Slide-by-Slide Explanation) on top.

This brief is **non-negotiable**. Read it twice before you touch a file.

═══════════════════════════════════════════════════════════════════════════════
0. PRIME DIRECTIVES — VIOLATION = HARD STOP
═══════════════════════════════════════════════════════════════════════════════

D1.  **NEVER copy directory paths from Mini-RAG.** VirtAI is layered Clean Architecture:
     domain/ → application/ → infrastructure/ → presentation/. The Mini-RAG MVC
     layout (controllers/, routes/, stores/, models/) **MUST NOT** appear anywhere
     in VirtAI. If you find yourself creating a folder called `controllers/` or
     `agents/graph/` — STOP and re-read this brief.

D2.  **NEVER port LangGraph.** Replace its StateGraph orchestration with explicit
     async function composition inside Use Cases. The reasons:
       • LangGraph adds a runtime dependency we don't need.
       • Clean Architecture forbids framework leakage into application layer.
       • Explicit orchestration is testable without graph mocking.

D3.  **Respect the existing ports.** VirtAI already has:
       • `app/domain/rag/ports.py`     → EmbeddingProvider, VectorStore, RerankerPort
       • `app/domain/chat/ports.py`    → BaseLLMProvider, ChatContextCachePort
       • `app/infrastructure/vector/pgvector_store.py` → already does Hybrid Search (RRF)
       • `app/infrastructure/rag/reranker.py`         → CrossEncoder lazy-loaded
     **DO NOT** create parallel/duplicate ports. **REUSE** them.

D4.  **No silent regressions.** Every file you modify must keep its existing public
     contract unless explicitly stated. The existing voice pipeline
     (`ConversationPipeline` in `application/voice/handle_voice_turn.py`) MUST continue
     to stream tokens with sub-second first-token latency. If a refactor risks
     latency, it goes behind a feature flag.

D5.  **Batch discipline.** This brief defines 16 batches. You execute **one batch
     at a time**. After each batch you MUST run the Code-Review Gate (Section 4).
     **Forbidden:** combining batches, skipping the gate, or "while I'm here"
     drive-by edits.

D6.  **No fabrication.** If a Mini-RAG file referenced below is unreadable for any
     reason, STOP and report. Do NOT guess what the prompt or logic "probably" was.

D7.  **Tests are deliverables, not afterthoughts.** Every Use Case ships with a unit
     test in the same batch. No PR is "done" without tests.

D8.  **Migrations are explicit.** If a batch requires a new DB column/table, you ship
     an Alembic migration in the SAME batch under `backend/alembic/versions/`.
     Filename pattern: `YYYYMMDD_<short_slug>.py`.

═══════════════════════════════════════════════════════════════════════════════

1. SOURCE-OF-TRUTH FILE INDEX (Mini-RAG)
═══════════════════════════════════════════════════════════════════════════════

These are the *only* Mini-RAG files whose logic you will lift. Read each one
before the batch that consumes it. Do **not** browse anything outside this list.

  IDX-01  src/agents/base/intent_utils.py
          → Task classification (SUMMARY/QUIZ/EXPLANATION/SIMPLE_QA) + RETRIEVAL_SIZES
  IDX-02  src/agents/base/AgentState.py
          → Fields list (we will NOT keep AgentState; we extract the *fields* into our
            dataclasses for parity)
  IDX-03  src/agents/base/AgentInterface.py
          → REFERENCE ONLY — not ported. We don't have a BaseAgent abstraction.
  IDX-04  src/agents/retrieval/RetrievalAgent.py
          → Dynamic fetch_limit (60 for broad/summary, 15 normal) + threshold
            (0.05 vs 0.30) logic. Lift the *logic*, fold it into our RetrievalUseCase.
  IDX-05  src/agents/reasoning/ReasoningAgent.py
          → Context-assembly with section headers (Retrieved Knowledge, Past Context,
            OCR, Vision) + citation builder. Fold into a new ContextAssemblyService.
  IDX-06  src/agents/response/ResponseFormatterAgent.py
          → Task-aware prompt selection + max_tokens map + Sources block.
            Fold into a new ResponseFormatterService.
  IDX-07  src/agents/response/SummaryGenerator.py
          → Map-Reduce: MAP at 10K chars, REDUCE at 12K chars, multi-stage merge.
            Lift verbatim algorithm into SummaryUseCase.
  IDX-08  src/agents/quiz/QuizAgent.py
          → Strict-JSON MCQ generation + schema validation. Lift into QuizUseCase.
  IDX-09  src/agents/diagram/DiagramAgent.py
          → Concept-extraction (MAP) → Mermaid flowchart (REDUCE). Lift into
            DiagramUseCase.
  IDX-10  src/agents/visualization/VisualizationAgent.py
          → Napkin AI integration (create → poll → fetch URLs). Lift into
            VisualizationUseCase.
  IDX-11  src/agents/router/RouterAgent.py
          → REFERENCE ONLY. We will NOT keep a RouterAgent; routing happens
            implicitly via the Use-Case picked by the endpoint + IntentClassifier
            (already in VirtAI) for casual-chat short-circuit.
  IDX-12  src/agents/memory/MemoryAgent.py + MemoryStore.py + MemorySchema.py
          → REFERENCE ONLY for Batch-9 (semantic memory). VirtAI already has
            ChatContextCachePort; we *extend* it, not replace it.
  IDX-13  src/stores/llm/templates/locales/en/rag.py
          → Full EN prompt set (system_prompt, document_prompt, footer_prompt,
            quiz_**prompt, summarize**_prompt). Lift TEXT VERBATIM.
  IDX-14  src/stores/llm/templates/locales/ar/rag.py
          → Same set, Arabic. Lift TEXT VERBATIM.
  IDX-15  src/stores/llm/templates/template_parser.py
          → REFERENCE ONLY — we replace with a simpler `string.Template`-based
            module (already started: backend/app/infrastructure/rag/rag_prompts.py).
  IDX-16  src/controllers/NLPController.py
          → REFERENCE ONLY — shows how the orchestration glues. We re-implement.
  IDX-17  src/routes/nlp.py
          → REFERENCE ONLY — endpoint list to inform our new routes.

═══════════════════════════════════════════════════════════════════════════════
2. EXECUTION PLAN — 16 BATCHES
═══════════════════════════════════════════════════════════════════════════════

Each batch follows this template:
  • Scope      — what you change (and what you DON'T)
  • Inputs     — Mini-RAG file IDs from Section 1
  • Deliverables — exact file paths in VirtAI
  • Acceptance — bullet checklist used in the Code-Review Gate
  • Risks      — pre-identified pitfalls to avoid

──── BATCH 0 — Foundation Audit (READ-ONLY, NO COMMITS) ────
  Scope:        Audit, do not modify. Produce `docs/refactor/00-audit.md`.
  Inputs:       IDX-01, IDX-04, IDX-06, IDX-13, IDX-14
  Deliverables:
    • backend/docs/refactor/00-audit.md  (markdown report)
        – Current VirtAI RAG flow diagram (text-art)
        – Mini-RAG flow diagram (text-art)
        – Gap matrix (mirrors the 8-row table in Section 1 of the user brief)
        – Risk register (DB schema impact, latency budget, dependency additions)
  Acceptance:
    [ ] Report compiles (renders as markdown)
    [ ] No source files modified
    [ ] Gap matrix has at least 8 rows, each with: Capability | Mini-RAG | VirtAI | Target State | Batch#
  Risks:        Scope creep. DO NOT propose extra features in this batch.

──── BATCH 1 — Domain Contracts (Pure Types, No Behavior) ────
  Scope:        Add domain types only. No imports from infrastructure. No I/O.
  Inputs:       IDX-01, IDX-02
  Deliverables:
    • backend/app/domain/rag/task_types.py    (new)
        – Enum TaskType { SIMPLE_QA, EXPLANATION, SUMMARY, QUIZ }
        – Enum Locale { EN, AR }
        – dataclass RetrievalSizing { fetch_limit:int, top_n:int, score_threshold:float }
        – constant TASK_RETRIEVAL_SIZES: dict[TaskType, RetrievalSizing]
        – constant TASK_MAX_TOKENS: dict[TaskType, int]
        – pure function classify_task_type(query:str, route_hint:str|None)->TaskType
        – pure function detect_locale(text:str)->Locale  (Arabic Unicode block check)
    • backend/app/domain/rag/citation.py    (new)
        – dataclass Citation { source:str, page:str|None, section:str|None }
        – pure function build_citations(chunks:list[DocumentChunk])->list[Citation]
        – pure function format_sources_block(citations, locale)->str
    • backend/tests/domain/rag/test_task_types.py
        – Cover: AR/EN keyword classification, long-query heuristic, locale detection
    • backend/tests/domain/rag/test_citation.py
        – Cover: dedup by (source,page,section), AR/EN heading
  Acceptance:
    [ ] Zero imports from app.infrastructure or app.application
    [ ] 100% branch coverage on classify_task_type and detect_locale
    [ ] All tests green
    [ ] mypy/ruff clean on new files
  Risks:        Don't import string.Template here — pure types only.

──── BATCH 2 — Prompt Catalog (EN + AR, Verbatim Lift) ────
  Scope:        Replace the thin `rag_prompts.py` with a full bilingual catalog.
  Inputs:       IDX-13, IDX-14
  Deliverables:
    • backend/app/infrastructure/rag/prompts/**init**.py        (re-export get_prompt_set)
    • backend/app/infrastructure/rag/prompts/en.py              (lift verbatim from IDX-13)
    • backend/app/infrastructure/rag/prompts/ar.py              (lift verbatim from IDX-14)
    • backend/app/infrastructure/rag/prompts/registry.py
        – class PromptSet (frozen): system, document, footer (+task-specific variants)
        – function get_prompt_set(task: TaskType, locale: Locale) -> PromptSet
        – Internal table mapping (task, locale) -> PromptSet
    • backend/app/infrastructure/rag/rag_prompts.py
        – Keep as a backward-compat shim that re-exports from prompts/en.py
        – Add deprecation warning when imported directly (loguru.warning, not Python warning)
    • backend/tests/infrastructure/rag/test_prompts_registry.py
        – Assert every (TaskType × Locale) combination returns a PromptSet
        – Assert AR prompts contain at least one Arabic Unicode codepoint
        – Assert EN prompts contain Hybrid-Knowledge-Rule trigger phrase
  Acceptance:
    [ ] Verbatim copy of system_prompt, document_prompt, footer_prompt (EN + AR)
    [ ] Includes: Hybrid Knowledge Rule, Mathematical/Technical Rigor section, Visual
        Drawing section, Sources & Citations rule, Formatting rules
    [ ] All 8 PromptSets present (4 tasks × 2 locales)
    [ ] Backward-compat shim works: existing code calling rag_prompts.system_prompt
        still functions
  Risks:        Encoding bugs in Arabic file — use UTF-8 BOM-free; verify locally with
                `python -c "from app.infrastructure.rag.prompts import ar; print(ar.system_prompt)"`

──── BATCH 3 — Task-Aware Retrieval (Drop-in Quality Boost #1) ────
  Scope:        Enhance RetrievalUseCase to use TASK_RETRIEVAL_SIZES; no new endpoints.
  Inputs:       IDX-04
  Deliverables:
    • Modify backend/app/application/rag/retrieval_use_case.py
        – Add optional parameter `task_type: TaskType = TaskType.SIMPLE_QA`
        – Use TASK_RETRIEVAL_SIZES[task_type] to override fetch_limit/top_k/threshold
        – Source-diversity decay (0.85^count) stays; it's already better than Mini-RAG
        – Keep existing public method signatures backward-compatible (task_type is kwarg)
    • Modify backend/app/application/chat/chat_use_case.py
        – Detect task_type with classify_task_type before calling retrieval
        – Pass task_type into retrieval.retrieve(...)
    • backend/tests/application/rag/test_retrieval_task_aware.py
        – Cover: SUMMARY query pulls ≥30 candidates pre-rerank
        – Cover: SIMPLE_QA pulls ≤20 candidates
        – Use AsyncMock for VectorStore + Reranker
  Acceptance:
    [ ] Existing voice pipeline test (test_pipeline_task_cancellation.py) still passes
    [ ] New retrieval test covers all 4 task types
    [ ] No new public API surface added (only optional kwarg)
    [ ] Latency benchmark: SIMPLE_QA path stays within ±10% of baseline (record numbers
        in docs/refactor/03-bench.md)
  Risks:        SUMMARY task with fetch_limit=60 may saturate token budget. Mitigation:
                downstream SummaryUseCase (Batch 5) re-chunks via map-reduce.

──── BATCH 4 — Task-Aware Response Formatter (Drop-in Quality Boost #2) ────
  Scope:        Introduce ResponseFormatterService; rewire ChatUseCase to use it.
  Inputs:       IDX-06
  Deliverables:
    • backend/app/application/rag/response_formatter.py    (new)
        – class ResponseFormatterService
            • build_system_prompt(task, locale, context, citations) -> str
            • get_max_tokens(task) -> int
            • format_final(answer:str, citations, locale) -> str   (appends Sources)
    • Modify backend/app/application/chat/chat_use_case.py
        – Use ResponseFormatterService instead of PromptBuilder for task-aware system prompt
        – Keep PromptBuilder for the legacy code path (deprecate gradually)
    • Modify backend/app/application/voice/pipeline_stages.py (LLMStage)
        – Same wiring as chat_use_case
        – Add `locale` propagation from session/user preference (default EN)
    • backend/tests/application/rag/test_response_formatter.py
  Acceptance:
    [ ] SIMPLE_QA response cap 1500 tokens, EXPLANATION cap 3000, SUMMARY 4000, QUIZ 2500
    [ ] Sources block auto-appended when citations exist
    [ ] AR queries produce AR-locale prompts (verify via classify locale test)
    [ ] Voice pipeline still streams within latency budget
  Risks:        Token budget for streaming voice — keep max_tokens conservative
                for voice path (override to 1024 if pipeline.is_voice flag).

──── BATCH 5 — Map-Reduce SummaryUseCase ────
  Scope:        New use case, new endpoint `POST /v1/rag/summarize`.
  Inputs:       IDX-07
  Deliverables:
    • backend/app/application/rag/summary_use_case.py    (new)
        – class SummaryUseCase
            • execute(document_id, user_id, locale) -> AsyncGenerator[str, None]
            • MAP at _BATCH_CHARS=10_000  /  REDUCE at_REDUCE_BATCH_CHARS=12_000
            • Multi-stage hierarchical merge when reduce overflows
        – Lift batching + merge prompt verbatim from IDX-07
    • backend/app/presentation/http/v1/endpoints/rag.py    (new file or append)
        – POST /v1/rag/summarize/{document_id}  (SSE stream)
    • backend/app/schemas/rag.py    (new)
        – SummaryRequest, SummaryChunkEvent (SSE payloads)
    • backend/alembic/versions/<YYYYMMDD>_summary_cache.py    (new migration)
        – table: summary_cache(document_id PK, locale, content TEXT, generated_at)
    • backend/tests/application/rag/test_summary_use_case.py
        – Small doc (single batch): direct polish path
        – Large doc (forces multi-stage reduce): mock LLM to return distinct notes
  Acceptance:
    [ ] Summary streams progressively (no buffering full output)
    [ ] Output structure matches Mini-RAG: # Title / ## Overview / Learning Objectives /
        Key Terms / Main Content / Examples / Summary
    [ ] Cache hit on second call for same (document_id, locale)
    [ ] Migration runs cleanly forward + reversibly backward
  Risks:        Map step is O(n) LLM calls — add concurrency cap (asyncio.Semaphore=3)
                to avoid Groq rate limits.

──── BATCH 6 — QuizUseCase + Endpoint ────
  Scope:        New use case + endpoint `POST /v1/rag/quiz`.
  Inputs:       IDX-08
  Deliverables:
    • backend/app/application/rag/quiz_use_case.py    (new)
        – class QuizUseCase
            • execute(document_id, user_id, num_questions:int=5, locale) -> list[QuizQuestion]
            • Strict JSON output via Groq structured-output guard (regex extraction fallback)
            • Validation: exactly 4 options, correct_answer ∈ options, no duplicate IDs
    • backend/app/domain/rag/quiz_entities.py    (new)
        – dataclass QuizQuestion { id, question, options:list[str], correct_answer:str, hint, explanation, citations:list[Citation] }
    • backend/app/presentation/http/v1/endpoints/rag.py
        – POST /v1/rag/quiz/{document_id}   (returns full QuizResponse JSON, NOT streamed)
    • backend/alembic/versions/<YYYYMMDD>_quiz_attempts.py
        – tables: quiz(id PK, document_id, user_id, locale, created_at)
                  quiz_question(id PK, quiz_id FK, payload JSONB)
                  quiz_attempt(id PK, quiz_id FK, user_id, score, answers JSONB, created_at)
    • backend/tests/application/rag/test_quiz_use_case.py
        – Mock LLM returns malformed JSON → use case repairs or retries (max 2)
        – Each question has exactly 4 unique options
        – correct_answer is one of the options
  Acceptance:
    [ ] num_questions in [3, 5, 10] all work
    [ ] Each question payload carries `citations: [Citation]` (source/page) — this is the
        NotebookLM "Why is this wrong?" backbone
    [ ] Quiz persisted, attempt can be replayed via GET /v1/rag/quiz/{quiz_id}
  Risks:        Groq may emit text outside JSON — use the `repair-json` extraction
                strategy (regex `\[.*\]` then `json.loads`); on second failure return 422.

──── BATCH 7 — DiagramUseCase + Endpoint ────
  Scope:        New use case + endpoint `POST /v1/rag/diagram`.
  Inputs:       IDX-09
  Deliverables:
    • backend/app/application/rag/diagram_use_case.py    (new)
        – class DiagramUseCase
            • execute(document_id, user_id, locale) -> DiagramArtifact
            • MAP: concept extraction per batch (8K chars)
            • REDUCE: emit valid Mermaid flowchart
            • Mermaid syntax validation (regex sanity-check; no full parser)
    • backend/app/domain/rag/diagram_entities.py
        – dataclass DiagramArtifact { title, diagram_type, mermaid_code, citations }
    • backend/app/presentation/http/v1/endpoints/rag.py
        – POST /v1/rag/diagram/{document_id}    (full JSON response with mermaid string)
        – GET  /v1/rag/diagram/{diagram_id}     (retrieve cached)
    • backend/alembic/versions/<YYYYMMDD>_diagram_cache.py
        – table: diagram_cache(id PK, document_id, locale, title, mermaid_code TEXT, generated_at)
    • backend/tests/application/rag/test_diagram_use_case.py
  Acceptance:
    [ ] Output passes regex check: starts with `flowchart` or `graph` token
    [ ] Single-document scope only (validate document_id belongs to user_id)
    [ ] Caching by (document_id, locale)
  Risks:        Mermaid syntax fragility — keep prompt strict, reject if reduce step
                produces > 60 nodes (sign of hallucination).

──── BATCH 8 — VisualizationUseCase (Napkin AI) ────
  Scope:        Per-message visualization. New endpoint `POST /v1/rag/visualize`.
  Inputs:       IDX-10
  Deliverables:
    • backend/app/application/rag/visualization_use_case.py    (new)
        – class VisualizationUseCase
            • execute(message_id, user_id) -> VisualizationArtifact | None
            • Pull last assistant message text from chat history
            • Call Napkin AI: POST /v1/visual → poll /status (≤20× / 3s) → fetch URLs
            • Cache per message_id
            • Graceful skip if NAPKIN_API_KEY missing → return Sentinel result with
              `unavailable=true, reason="quota_exceeded" | "not_configured" | "timeout"`
    • backend/app/infrastructure/external/napkin_client.py    (new)
            • Isolate Napkin HTTP details behind a port-style adapter
    • backend/app/domain/rag/visualization_entities.py
        – dataclass VisualizationArtifact { urls:list[str], message_id, unavailable:bool, reason:str|None }
    • backend/app/presentation/http/v1/endpoints/rag.py
        – POST /v1/rag/visualize/{message_id}
    • backend/alembic/versions/<YYYYMMDD>_visualization_cache.py
    • backend/tests/application/rag/test_visualization_use_case.py
  Acceptance:
    [ ] If API key absent → 200 OK + `unavailable=true, reason=not_configured`
        (NEVER 500 — frontend needs to show a friendly toast)
    [ ] If API responds 429 → `unavailable=true, reason=quota_exceeded`
    [ ] Polling capped at 60s (20 × 3s)
    [ ] Visualization rebound to a specific message_id, not the whole conversation
  Risks:        Napkin quota — the user explicitly wants a warning UX. Backend must
                surface a *structured* reason so frontend can localize.

──── BATCH 9 — Slide-by-Slide ExplainUseCase ────
  Scope:        Sequential slide explanation with pause-for-Q&A. New endpoint
                `WS /v1/rag/explain` (WebSocket — fits VirtAI's WS-first design).
  Inputs:       (No direct Mini-RAG equivalent; design fresh, inspired by NotebookLM
                "Audio Overview" pause behavior)
  Deliverables:
    • backend/app/application/rag/explain_use_case.py    (new)
        – class ExplainUseCase
            • Accepts: document_id, single document (must be slide deck: PDF/PPTX/MD)
            • Yields events: SlideStartEvent → SlideContentTokens... → SlideEndEvent
              → AwaitInputEvent { prompt: "Question or continue?" }
            • If user sends `{"action":"continue"}` → next slide
            • If user sends `{"action":"question","text":"..."}` → branch to inline
              Q&A via ChatUseCase scoped to current slide's chunks → resume after answer
            • If user sends `{"action":"stop"}` → graceful close
        – State machine with explicit states: IDLE → EXPLAINING → AWAITING → ANSWERING → EXPLAINING
    • backend/app/domain/rag/explain_entities.py    (slide events, state machine enum)
    • backend/app/presentation/ws/explain_handler.py    (new WS handler)
    • backend/tests/application/rag/test_explain_use_case.py
        – State transitions, mid-explanation interruption, resume correctness
  Acceptance:
    [ ] Works ONLY when user uploaded docs AND has not sent a chat message yet
        (gate via session flag `is_fresh_session`)
    [ ] Each slide has its own scoped retrieval (slide_index passed as metadata filter)
    [ ] State machine has unit tests for every transition
    [ ] WS gracefully resumes from `AWAITING` after Q&A
  Risks:        WebSocket reconnection — persist current_slide_index in session_state so
                a disconnect doesn't restart from slide 0.

──── BATCH 10 — Frontend: Quiz UI (NotebookLM-style) ────
  Scope:        Add Quiz button above the Avatar, full-screen expand UI.
  Inputs:       Backend endpoints from Batch 6.
  Deliverables:
    • frontend/src/features/quiz/                                (new feature module)
        – QuizButton.tsx          → triggers POST /v1/rag/quiz, opens drawer
        – QuizDrawer.tsx          → 90% viewport overlay, expand/collapse animation
        – QuizQuestionCard.tsx    → one MCQ with radio options + Submit
        – WhyWrongPanel.tsx       → after wrong answer: explanation + Citation links
                                     that open the source PDF page in a side panel
        – useQuizSession.ts       → hook managing quiz state, score, current question
        – quizApi.ts              → client wrapper
    • frontend/src/features/documents/components/PdfPageViewer.tsx
        – Lazy viewer for citation deep-links (only loads when citation clicked)
    • frontend/src/widgets/Classroom/AvatarTopBar.tsx          (new)
        – Container for Quiz / Diagram / Visualize buttons (Batches 10-12 share it)
    • Update widgets/Classroom/ClassroomShell.tsx              (wire AvatarTopBar)
    • frontend/test/features/quiz/QuizDrawer.test.tsx
  Acceptance:
    [ ] Quiz drawer expands to ≥90% viewport on desktop, 100% on mobile
    [ ] Smooth expand/collapse (Framer Motion or equivalent — match existing UX)
    [ ] Citations are clickable → open PdfPageViewer at the right page
    [ ] Empty-state when no documents uploaded: button disabled with tooltip
    [ ] Loading state: skeleton cards while generation runs
    [ ] All strings keyed for i18n (AR + EN)
  Risks:        Heavy PDF viewer bundle. Mitigation: dynamic import + react.lazy.

──── BATCH 11 — Frontend: Diagram UI ────
  Scope:        Add Diagram button next to Quiz. Mermaid renderer with expand/collapse.
  Deliverables:
    • frontend/src/features/diagram/
        – DiagramButton.tsx        → opens document-picker modal (single doc only)
        – DocumentPicker.tsx       → list user's docs, radio-select one
        – DiagramViewer.tsx        → centered card, Mermaid render, expand/download SVG
        – useMermaidRender.ts      → dynamic import of mermaid library
        – diagramApi.ts
    • Update AvatarTopBar.tsx (add DiagramButton)
    • Acceptance:
        [ ] Document picker enforces exactly 1 selection
        [ ] Diagram renders within 3s after API response
        [ ] Download button exports SVG + PNG
        [ ] Expand mode fills viewport, ESC to close
  Risks:        Mermaid CDN/bundle size — load on demand only.

──── BATCH 12 — Frontend: Per-Message Visualization Button ────
  Scope:        Under each assistant message, next to copy button, add Visualize button.
  Deliverables:
    • frontend/src/features/chat/components/MessageBubble.tsx (modify)
        – Add VisualizeButton next to existing CopyButton (only for assistant messages)
    • frontend/src/features/chat/components/VisualizeButton.tsx (new)
        – Calls POST /v1/rag/visualize/{message_id}
        – On `unavailable=true`:
            • reason=quota_exceeded   → toast: "We can't create an image right now,
                                                 please try again later."
            • reason=not_configured   → button hidden entirely (feature-flagged off)
            • reason=timeout          → toast: "The image is taking too long. Retry?"
        – On success: inline thumbnail strip below the message + lightbox on click
    • Acceptance:
        [ ] Button shown ONLY for assistant messages, never user messages
        [ ] Button shown ONLY for the last message (matches user spec; render condition
            uses index === messages.length - 1)
        [ ] All warning text localized (AR + EN)
  Risks:        Surge on Napkin quota — debounce 1 request/5s per user (client-side).

──── BATCH 13 — Frontend: Explain Button (Slide-by-Slide w/ Pause) ────
  Scope:        Add Explain button at the conversation header (visible only when
                docs uploaded AND zero messages sent yet).
  Deliverables:
    • frontend/src/features/explain/
        – ExplainButton.tsx       → conditional render based on session state
        – ExplainSession.tsx      → full-screen experience (avatar talks, slide preview
                                     on the right, controls bottom: ⏸ Pause / 💬 Question / ▶ Continue / ⏹ Stop)
        – useExplainWS.ts         → WS client for /v1/rag/explain
        – SlideQuestionInput.tsx  → modal-like inline input when state=AWAITING
    • Update widgets/Classroom/ClassroomShell.tsx for state gating
    • Acceptance:
        [ ] Button only visible when `session.documents.length > 0 &&
            session.messages.length === 0`
        [ ] Pause works mid-token (TTS stops, can resume from same offset)
        [ ] Question flow doesn't lose slide progress
        [ ] State indicator (current slide N of M) always visible
  Risks:        TTS interruption — must reuse existing pipeline.abort() path.

──── BATCH 14 — Testing Hardening Wave ────
  Scope:        Comprehensive testing across the new surface.
  Deliverables:
    • backend/tests/integration/test_rag_quality_corpus.py
        – Seeded corpus of 3 lectures (small/medium/large)
        – Assert SIMPLE_QA precision ≥ baseline + 15% on a fixed Q-set (8 questions)
        – Assert SUMMARY contains ≥80% of key terms from gold-standard summary
    • backend/tests/integration/test_quiz_end_to_end.py
    • backend/tests/integration/test_diagram_end_to_end.py
    • backend/tests/integration/test_explain_ws.py
        – Connect WS, walk through 3 slides, inject a question mid-slide-2, verify resume
    • backend/tests/load/test_rag_throughput.py
        – Locust file: 50 concurrent users hitting /v1/rag/answer for 60s
        – Pass criteria: p95 latency < 4s, error rate < 1%
    • backend/tests/load/test_summary_concurrent.py
        – 5 concurrent summaries on a 30-page document
        – Pass criteria: all complete in < 60s, no Groq rate-limit errors
    • frontend/test/automation/playwright/
        – e2e_quiz_flow.spec.ts
        – e2e_diagram_flow.spec.ts
        – e2e_explain_flow.spec.ts
    • backend/docs/refactor/14-test-report.md   (auto-generated metrics summary)
  Acceptance:
    [ ] All integration tests green in CI
    [ ] Load test report attached to PR
    [ ] e2e tests run headless in CI on every push to refactor branch
  Risks:        Flaky tests from LLM non-determinism. Mitigation: snapshot golden outputs
                for structure (headings, count of citations), not exact text.

──── BATCH 15 — Observability & A/B Quality Harness ────
  Scope:        Make quality regressions visible.
  Deliverables:
    • backend/app/shared/metrics.py (extend)
        – Counters: rag_retrieval_total{task_type, status}, rag_low_confidence_total,
                    rag_summary_map_calls_total, quiz_validation_failures_total
        – Histograms: rag_first_token_seconds{task_type}, rag_full_answer_seconds{task_type}
    • backend/app/application/rag/ab_runner.py    (new)
        – Optional shadow run: when env flag RAG_AB=1, for each query run both the new
          and the legacy prompt path, log structural deltas (token count, citation count,
          heading count) to a JSONL file under /var/log/rag_ab.log
        – Never affects user-facing response (always returns NEW path result)
    • backend/docs/refactor/15-quality-dashboard.md
        – Grafana panel definitions (queries only — actual dashboards out-of-scope)
  Acceptance:
    [ ] Metrics emit on every RAG call without measurable latency overhead (< 1ms)
    [ ] AB log file rotates daily, capped at 100MB
    [ ] Docs include screenshots of expected Grafana panels (mock OK)
  Risks:        Metrics cardinality blowup — keep label set small (task_type, locale only).

═══════════════════════════════════════════════════════════════════════════════
3. CROSS-CUTTING ENGINEERING STANDARDS
═══════════════════════════════════════════════════════════════════════════════

S1. Naming & Style
    • Python: PEP-8, ruff with project's existing config, mypy --strict on new files
    • TypeScript: existing prettierrc + eslint config; strict mode; no `any`
    • File names: snake_case for Python, PascalCase.tsx for React components
    • Class names match file names (one main class per file)

S2. Async Discipline
    • All I/O is async. Never block the event loop.
    • Use `asyncio.gather` with concurrency caps via `asyncio.Semaphore`.
    • For sync-only libs (e.g. CrossEncoder.predict), use `loop.run_in_executor`.

S3. Error Handling
    • Domain layer raises domain-specific exceptions (in app.shared.errors).
    • Application layer catches infrastructure errors and translates to domain errors.
    • Presentation layer is the ONLY place HTTP status codes are chosen.
    • NEVER swallow exceptions silently — at minimum `logger.warning(..., exc_info=True)`.

S4. Logging
    • Use loguru (already in project). Structured fields:
      logger.info("...", session_id=..., trace_id=..., task_type=...)
    • Never log full prompt content at INFO level — DEBUG only, behind PII redaction.

S5. Dependency Injection
    • Use cases receive ports via constructor (no service locator).
    • Wiring happens in `backend/app/presentation/http/v1/dependencies.py`
      (extend the existing module — don't create a parallel one).

S6. Backward Compatibility
    • Every existing endpoint behavior must be preserved unless this brief explicitly
      changes it.
    • Existing tests must remain green; you may extend them, not delete them.

S7. Documentation
    • Each new module gets a 5-line module docstring: purpose, ports used, gotchas.
    • Each Use Case has a docstring example block.

═══════════════════════════════════════════════════════════════════════════════
4. CODE-REVIEW GATE — RUN AFTER EACH BATCH
═══════════════════════════════════════════════════════════════════════════════

After finishing a batch, run THIS checklist self-review. If any item fails, FIX
before moving to the next batch. Output the completed checklist as
`backend/docs/refactor/NN-review.md` (NN = batch number).

  ARCHITECTURE
    [ ] No imports leak from infrastructure → domain
    [ ] No imports leak from application → presentation
    [ ] No new top-level package added without justification
    [ ] LangGraph still NOT present in dependencies (pyproject.toml unchanged unless
        an essential library was added — and that addition is documented)

  CORRECTNESS
    [ ] All acceptance items in the batch are checked
    [ ] All new tests pass locally; no test was skipped/xfailed
    [ ] No `# type: ignore` added without a comment explaining why
    [ ] No `print(...)` left in code — only loguru

  QUALITY
    [ ] Cyclomatic complexity of new functions ≤ 10 (use ruff's mccabe rule)
    [ ] Public methods have type hints
    [ ] No file exceeds 400 lines (split if it does)
    [ ] No copy-paste from Mini-RAG of code that imports langgraph, fastapi-streamlit
        artifacts, or controllers/

  SECURITY
    [ ] No secrets logged (API keys, tokens)
    [ ] user_id is enforced on every query path (no cross-user data leak)
    [ ] Endpoints under /v1/rag/* require auth dependency (matches existing pattern)

  PERFORMANCE
    [ ] No N+1 DB queries introduced (review SQL via logger.debug at SQL=DEBUG)
    [ ] Voice pipeline first-token latency benchmark attached (Batch 3+)
    [ ] No synchronous network call inside async function

  HUMAN VERIFICATION
    [ ] One manual smoke test scenario executed and screen-recorded
        (artifact attached or steps documented)
    [ ] Code review checklist file committed: docs/refactor/NN-review.md

═══════════════════════════════════════════════════════════════════════════════
5. INTERACTION PROTOCOL WITH ME (THE OWNER)
═══════════════════════════════════════════════════════════════════════════════

P1. Start each batch by posting a one-paragraph plan that lists the files you will
    touch and the libraries you will add (if any). Wait for my explicit "GO"
    before writing code. **No GO = no code.**

P2. End each batch by posting:
    • The diff stats (files changed, +lines / -lines)
    • The completed Code-Review Gate checklist
    • Any open questions (numbered)

P3. If you encounter ambiguity, STOP and ask. Numbered, specific questions only.
    No "should I do X or Y" — give me your recommendation + tradeoffs, ask me to
    confirm.

P4. If you discover a bug in existing code unrelated to the current batch, log it
    in `docs/refactor/bugs-found.md` and KEEP MOVING. Do not fix it inside the
    current batch. Fix-it batches are scheduled separately.

P5. NEVER push to `main` or `BugFix-avatar` directly. Use feature branches:
    `refactor/rag/batch-NN-<slug>`. PR title format:
    `[Batch NN] <imperative summary>`

═══════════════════════════════════════════════════════════════════════════════
6. OUT-OF-THE-BOX UX/PRODUCT IDEAS (For Your Consideration, NOT in Plan)
═══════════════════════════════════════════════════════════════════════════════

These are bonus ideas the owner hinted at wanting. Do NOT execute without explicit
approval per idea. They are listed here so you can propose them as separate batches
after the 16-batch plan completes.

X1. **Quiz Adaptive Difficulty** — After 3 wrong answers in a row, regenerate
    next 2 questions targeting the same chapter at "easier" difficulty.

X2. **Diagram Variant Mode** — Beyond flowchart: sequence diagram for processes,
    mindmap for chapter overview, ER diagram for data-model lectures. Pick auto
    based on content classification.

X3. **Avatar-aware Explain Mode** — During slide-by-slide explanation, the avatar's
    gaze/posture changes per slide section (introducing vs detailed step vs example)
    — leverages your existing animation_mapper.py.

X4. **Cross-document Citations** — When a chunk's content closely matches a chunk
    from another document, surface "Related in: <other_doc>" in the citation block.

X5. **Quiz from Wrong Answers** — A "Review Mistakes" mode that regenerates a mini-quiz
    using ONLY chunks tied to questions the user got wrong in their history.

X6. **Explain-as-Podcast** — Toggle that pre-renders all slide explanations to MP3
    chunks (using existing TTS cache) and streams them as a coherent audio lecture
    with pause/skip controls — closer to NotebookLM Audio Overview.

X7. **Quality-Watch dashboard** — Surface the Batch-15 AB results inside the app
    (admin-only route) so the owner can spot quality regressions per Groq model swap.

═══════════════════════════════════════════════════════════════════════════════
END OF BRIEF — Acknowledge with: "BRIEF READ. Awaiting GO for Batch 0."
═══════════════════════════════════════════════════════════════════════════════
