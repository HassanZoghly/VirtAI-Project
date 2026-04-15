# How It Works Sticky Section Redesign

## Problem
The current `HowItWorks` section has excessive vertical spacing, weak visual hierarchy, and non-intentional scroll flow. The heading context is lost too early, and the section feels static instead of guided.

## Goal
Refactor `frontend/src/widgets/Overview/HowItWorks.jsx` into a production-quality SaaS storytelling section with:
- Sticky heading/subtitle context
- Tight, connected layout
- Scroll-synced step activation (VOICE → ASR → RAG → LLM → TTS → AVATAR)
- Smooth, subtle motion and clear active-state hierarchy

## Confirmed UX Decisions
- Sticky behavior is **section-scoped** (not global across the entire page).
- Interaction approach: **Sticky Header + Scroll Progress Timeline**.

## Component Design

### 1. Section Layout
- Use a single section container with reduced vertical spacing (avoid large empty blocks).
- Keep the heading area sticky inside section (`top-*`) so title/subtitle remain visible during section scroll.
- Layout:
  1. Sticky header (title + process subtitle)
  2. Main content area below:
     - Left column: vertical timeline (6 steps)
     - Right column: active-step detail panel

### 2. Scroll and Activation Model
- Track section-local scroll progress with a lightweight listener.
- Map progress to a stable active step index (0..5).
- Update active step as the user scrolls through the section.

### 3. Visual Hierarchy
- Strong heading weight and high-contrast title.
- Subtitle in smaller uppercase style for process readability.
- Inactive timeline steps: muted text and subtle markers.
- Active timeline step: accent color, subtle glow, and slight scale.
- Detail panel mirrors active step for clear “current state.”

### 4. Motion Behavior
- Timeline transitions: smooth ease-in-out.
- Active-step state: subtle scale and glow, no over-animation.
- Detail panel transition: fade + slight slide when step changes.
- Connector rail fill animation tied to active progress.
- Respect reduced-motion settings.

### 5. Accessibility
- Preserve semantic section + heading hierarchy.
- Mark active timeline item with `aria-current="step"`.
- Maintain readable contrast across active/inactive states.
- Keep keyboard/focus behavior safe (no traps, no inaccessible custom controls).

### 6. Performance
- No heavy visual systems (no canvas/3D in this component).
- Use lightweight motion primitives and CSS transitions.
- Keep state updates minimal and component-local.

## Scope
- In scope: `frontend/src/widgets/Overview/HowItWorks.jsx`
- Out of scope: unrelated Overview sections and global page orchestration.

## Acceptance Criteria
1. Heading and process subtitle remain visible while scrolling through this section.
2. Vertical spacing is tighter with no obvious dead space.
3. Steps activate sequentially with smooth transitions.
4. Active step is visually dominant; inactive steps remain readable but subdued.
5. Overall section reads as guided product storytelling rather than static cards.
