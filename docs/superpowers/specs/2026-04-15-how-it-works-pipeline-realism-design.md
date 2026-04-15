# How It Works — Realistic Pipeline Simulation Design

## Problem

The current How It Works animation is visually polished but still reads as a highlighted timeline rather than a true causal system flow. Stages can feel decorative instead of functionally connected, which weakens trust and comprehension.

## Goal

Refactor the section into a realistic, scroll-guided pipeline simulation for:

`VOICE → ASR → RAG → LLM → TTS → AVATAR`

The user should instantly understand what is happening now, what just happened, and what happens next.

## Scope

In scope:

- `frontend/src/widgets/Overview/HowItWorks.jsx`
- Supporting tests for overview behavior and sequence semantics
- Maintain integration in `OverviewPage`

Out of scope:

- New backend/system behavior
- Full-page layout redesign outside this section
- Heavy 3D additions

## Approved Design

### 1. Architecture

Refactor into a compact, single-column sticky rail with three layers:

1. Sticky header (title, subtitle, controls)
2. Vertical pipeline rail (six connected stage nodes)
3. Active-stage detail panel

Each stage uses explicit phases:

- `idle`
- `receiving`
- `processing`
- `output`
- `completed`

Only one stage may be in `processing` at any time.

### 2. Interaction and Data Flow

Progression is **scroll-driven** (primary) with optional controls for play/pause/replay.

Each stage visibly renders:

1. Input artifact
2. Processing state
3. Output artifact
4. Handoff to next stage

Stage semantics:

- **VOICE**: waveform pulse as incoming audio signal
- **ASR**: audio converts to transcript text
- **RAG**: context/doc snippets join transcript
- **LLM**: token stream/thinking state produces response text
- **TTS**: response text converts to waveform/audio packet
- **AVATAR**: speaking/reactive final delivery state

Connectors animate strictly top→bottom. A connector pulse starts only after the current stage reaches output/completed state.

### 3. Visual and Layout Direction

- Tight vertical composition with no dead gaps
- Sticky context always visible
- Strong hierarchy: bold heading, clear pipeline subtitle, readable stage labels
- Dark SaaS palette with accent-driven active state
- Distinct but subtle idle/active/completed visual states

### 4. Motion Rules

- No random simultaneous highlights
- Sequential causality only
- Smooth ease-in-out transitions
- Subtle glow/scale feedback on active stage
- Lightweight animations (CSS + existing motion primitives)

### 5. Accessibility and UX

- Semantic section/headings preserved
- `aria-current` on active stage
- Live region for active stage summary updates
- Keyboard-accessible play/pause/replay controls with visible focus
- Respect `prefers-reduced-motion`

### 6. Performance and Structure

- Keep component modular; avoid unnecessary re-renders
- Derive stage visuals from compact state model
- Avoid heavy libraries or 3D expansion

## Testing Requirements

Update/add tests to verify:

1. Pipeline sequence remains ordered
2. Only one stage is active/processing at a time
3. Completed stages remain visually/semantically distinguishable from upcoming stages
4. Controls and key section semantics render correctly

## Acceptance Criteria

- The section feels like a real system pipeline, not decorative UI
- Cause/effect between stages is explicit without external explanation
- Sticky context stays visible while scrolling through stages
- Motion is smooth, purposeful, and lightweight
- Accessibility and keyboard operation remain solid
