# 🔍 Summary Analysis of the Current Overview

Before I write the prompt, here are the key points that came from reading the code:

| Category                | Detected Issues                                                                                                                                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🧱 Architecture**     | `OverviewPage.tsx` has 5 mixed responsibilities (idle scheduling, perf detection, splash, ambient toggle, phase reveal). `CircuitBoardBackground.tsx` is a single ~400-line file. `HowItWorks.tsx` has 3 inline sub‑components. `Navbar.tsx` combines `IntersectionObserver` + `MutationObserver` + scroll lock in one effect. |
| **🔤 TypeScript**       | All components lack `interface Props`. `as unknown as` casts in `OverviewPage`. `stepRefs.current = []` without a type. Inconsistent imports (`motion/react` vs the usual `framer-motion`).                                                                                                                |
| **🎨 UX/UI**            | `HowItWorks` uses **nested scroll** (`overflow-y-auto max-h-[60vh]`) — that’s bad UX and a client complaint. Hero is static with no motion. `TechStackSection` has no categories. `DemoPreview` is just an image. Footer is short and sparse. No Stats / Testimonials / Pricing. Splash is fixed at 2.8s. |
| **⚡ Performance**       | `MutationObserver` on `document.body` is over‑engineered. Canvas renders every frame without visibility check for pulses. No `React.memo` on steps and features.                                                                                                                                          |
| **♿ A11y**              | Mobile menu has no focus trap. Some contrast ratios are weak (`text-offwhite/38`). Missing `aria-label` on tech icons.                                                                                                                                                                                   |
| **🔡 Typography**       | `var(--font-display)` is used but there’s no clear definition or fallback stack. No variable font. No `font-feature-settings`.                                                                                                                                                                            |
| **🌀 Scroll Animation** | What the client describes is **Section Pinning + Scroll‑Scrubbing** (Apple/Stripe/Linear style). The best solution: **GSAP ScrollTrigger + Lenis** or **Framer Motion `useScroll` + sticky containers** with reverse‑aware progress.                                                                       |

---

# 📋 Full Prompt for the Agent (copy it as‑is)

````markdown
# 🎯 MISSION: Transform VirtAI Overview into a World‑Class Premium SaaS Landing Page

You are a **Senior Frontend Architect & UI/UX Engineer** working on the VirtAI landing page (an AI‑powered teaching assistant with a 3D avatar, real‑time voice, ASR/TTS, RAG, and LLM pipeline). The current implementation is **functional but feels like a student project**. Your job is to elevate it to the level of **Linear, Vercel, Anthropic, Apple, and Stripe** — clean, premium, cinematic, and engineering‑grade.

---

## 📂 Files You MUST Refactor

### Pages & containers
- `frontend/src/pages/Overview/index.tsx`
- `frontend/src/features/overview/components/OverviewPage.tsx`
- `frontend/src/features/overview/index.ts`

### Overview widgets (the visible UI)
- `frontend/src/widgets/Overview/HeroSection.tsx`
- `frontend/src/widgets/Overview/Navbar.tsx`
- `frontend/src/widgets/Overview/SplashScreen.tsx`
- `frontend/src/widgets/Overview/HowItWorks.tsx`  ← **HIGHEST PRIORITY**
- `frontend/src/widgets/Overview/FeaturesSection.tsx`
- `frontend/src/widgets/Overview/TechStackSection.tsx`
- `frontend/src/widgets/Overview/DemoPreview.tsx`
- `frontend/src/widgets/Overview/Footer.tsx`
- `frontend/src/widgets/Overview/CircuitBoardBackground.tsx`
- `frontend/src/widgets/Overview/components/SectionHeader.tsx`

### Data & styles
- `frontend/src/features/overview/data/*` (features, howItWorks, team, techStack)
- `frontend/src/app/styles/index.css`, `app.css`
- `frontend/index.html` (font loading)
- `tailwind.config.js` (extend theme tokens)

---

## ⚙️ NON‑NEGOTIABLE PRINCIPLES (apply everywhere)

1. **TypeScript‑strict**: every component MUST have a typed `interface Props`. No `any`, no `as unknown as`, no untyped `useRef([])`. Use `React.FC` sparingly — prefer explicit return types.
2. **Single Responsibility per file**: if a file > ~180 LOC or has > 1 conceptual job, split it.
3. **Hooks over inline effects**: any non‑trivial `useEffect` becomes a custom hook in `widgets/Overview/hooks/`.
4. **`framer-motion`** (NOT `motion/react`) — pick one and unify all imports.
5. **No nested scroll containers** unless absolutely required (the current `how-it-works-scroll` with `max-h-[60vh]` is BANNED).
6. **Mobile‑first responsive**: every section works flawlessly from 320px → 4K.
7. **Reduced motion**: every animation respects `useReducedMotion()`. No exceptions.
8. **`prefers-color-scheme`** awareness (dark is default, but tokens should be theme‑able).
9. **WCAG AA contrast** minimum — replace `text-offwhite/38` with `text-offwhite/55` where it's body text.
10. **Lazy + code‑split** every below‑the‑fold section (already partially done — preserve it).

---

## 🗂️ PHASE 1 — Architecture & File Split

### 1.1 Split `OverviewPage.tsx` into hooks
Create under `frontend/src/features/overview/hooks/`:
- `useProgressivePhases.ts` — replaces the inline `scheduleIdleTask` + `PHASE2_SEQUENCE` reveal logic. Returns `{ phase2, isAmbientReady }`.
- `useReducedMotionPreference.ts` — encapsulates the `matchMedia` listener.
- `useDevicePerformance.ts` — wraps `isLowPerformanceDevice()` with proper typing for `Navigator.connection` and `deviceMemory` (declare a `NavigatorWithExtras` interface).
- `useSplashSession.ts` — manages `sessionStorage` key `virtai:overview-splash-seen` + the show/hide cycle.

After the split, `OverviewPage.tsx` MUST be **< 90 lines** and contain only:
- Helmet meta
- Hook calls
- The `<DeferredSection>` JSX tree

### 1.2 Split `CircuitBoardBackground.tsx`
Move to `frontend/src/widgets/Overview/canvas/`:
- `circuitColors.ts` — `PULSE_PALETTE`, `pickColor()`, `TRACK_COLOR`
- `circuitPaths.ts` — `generatePaths`, `buildSmoothedPath`, `segLengths`, `pointAtLength`, `findJunctions`
- `circuitPulse.ts` — `createPulse`, `resetPulse`, `initPulseBase`
- `useCircuitCanvas.ts` — the RAF loop + ResizeObserver hook
- `CircuitBoardBackground.tsx` — pure component, < 60 lines, just `<canvas>` + the hook

Add typed interfaces: `Path`, `Pulse`, `Junction`, `Point`, `PulseColor`.

### 1.3 Split `HowItWorks.tsx`
Create:
- `HowItWorks/index.tsx` — main orchestrator
- `HowItWorks/PipelineBadge.tsx`
- `HowItWorks/TimelineStep.tsx` (wrap in `React.memo`)
- `HowItWorks/StepProgress.tsx` (the progress bar)
- `HowItWorks/useScrollPipeline.ts` ← **the new scroll‑pinning hook (Phase 3)**
- `HowItWorks/types.ts` — `PipelineStep`, `StepIconKey`, `PipelineNode`

### 1.4 Slim down `Navbar.tsx`
- Extract `useActiveSection.ts` — IntersectionObserver only (DROP the MutationObserver — instead, observe in a layout effect after sections mount).
- Extract `useScrollVisibility.ts` — visibility‑on‑scroll‑past‑hero.
- Extract `MobileMenu.tsx` — with **proper focus trap** (use `focus-trap-react` or a custom 30‑line hook).
- Add `Esc`‑to‑close, body‑scroll‑lock when open.

### 1.5 Type all data files (`data/*.ts`)
Define and export interfaces:
```ts
// data/types.ts
import type { IconType } from 'react-icons';
export interface Feature { id: string; title: string; description: string; icon: IconType; }
export interface PipelineStep { step: number; label: string; description: string; output: string; }
export interface TeamMember { name: string; role?: string; github: string; linkedin?: string; avatar: string; }
export interface TechItem { id: string; label: string; icon: IconType; category: 'frontend' | 'backend' | 'ai' | 'infra'; }
```

---

## 🎨 PHASE 2 — Design System Overhaul

### 2.1 Typography (premium + brandable + readable)

Update `index.html` to load **variable fonts** via Google Fonts or self‑host:
- **Display font**: `Instrument Serif` or `Cal Sans` or `General Sans Variable` — for hero headlines (humanistic, premium)
- **UI/Body font**: `Inter Variable` (the de‑facto modern UI font; supports OpenType features)
- **Mono font**: `JetBrains Mono Variable` (for the `OUT →` pipeline output)

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300..800&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@300..700&display=swap" rel="stylesheet" />
```

In `index.css`:
```css
:root {
  --font-display: 'Instrument Serif', 'Cal Sans', ui-serif, Georgia, serif;
  --font-sans: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
}
html { font-family: var(--font-sans); font-feature-settings: 'cv11', 'ss01', 'ss03', 'cv02'; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
.font-display { font-family: var(--font-display); letter-spacing: -0.02em; }
.tabular { font-variant-numeric: tabular-nums; }
```

Extend `tailwind.config.js`:
```js
theme: { extend: {
  fontFamily: {
    display: ['var(--font-display)'],
    sans: ['var(--font-sans)'],
    mono: ['var(--font-mono)'],
  },
  colors: {
    dark: '#0A0908',     // slightly deeper, more cinematic
    offwhite: '#F5F1EC',
    gold: { DEFAULT: '#B4AB8B', soft: '#C9C0A0', deep: '#8E866B' },
    crimson: { DEFAULT: '#6D001A', soft: '#9B0827', glow: '#FF1744' },
  },
  // ...
}}
```

Replace ALL `style={{ fontFamily: 'var(--font-display)' }}` inline styles with `className="font-display"`.

### 2.2 Color & Lighting upgrades
- Add a subtle **noise/grain texture** (an SVG or PNG noise overlay at 3‑5% opacity) over the whole page — instant premium feel.
- Add **mesh gradients** to Hero and Footer (use a `<MeshGradient>` component or CSS conic‑gradient with `mix-blend-mode: screen`).
- Add **inner glow / vignette** on hero image with `box-shadow: inset 0 0 120px rgba(0,0,0,.5)`.

### 2.3 Spacing & Rhythm
- Standardize section vertical rhythm to `py-32 md:py-40 lg:py-48` (currently inconsistent `py-20`, `py-28`).
- Cap content widths consistently: `max-w-6xl` for content, `max-w-7xl` for hero/footer.

---

## 🌀 PHASE 3 — The Premium Scroll‑Driven Pipeline (the BIG one)

The user described this pattern: when scrolling reaches `HowItWorks`, the **page scroll pauses** and instead drives the pipeline progression. When all 6 stages are revealed, the page continues scrolling. **Reverse must work too** (scrolling up rewinds the pipeline before unpinning).

This is called **"section pinning + scroll‑scrubbed animation"** — used by Apple, Linear, Stripe, Anthropic.

### 3.1 Implementation strategy (PREFERRED: Framer Motion, no GSAP needed)

Build `useScrollPipeline.ts`:

```tsx
import { useScroll, useTransform, MotionValue } from 'framer-motion';
import { useRef } from 'react';

export function useScrollPipeline(stepCount: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Track scroll across the entire pinned container.
  // Container height in CSS = (stepCount + 1) * 100vh, so total scroll distance scales with step count.
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'], // 0 when section top hits viewport top, 1 when section bottom leaves
  });
  // Map progress 0..1 → step index 0..stepCount-1 (floor)
  const activeStep = useTransform(scrollYProgress, (p) => Math.min(stepCount - 1, Math.floor(p * stepCount)));
  // Per‑step progress 0..1 (for the connector fill animation)
  const stepProgress = useTransform(scrollYProgress, (p) => (p * stepCount) % 1);
  return { containerRef, scrollYProgress, activeStep, stepProgress };
}
```

### 3.2 New `HowItWorks` JSX structure

```tsx
<section id="how-it-works" ref={containerRef} style={{ height: `${(steps.length + 1) * 100}vh` }}>
  <div className="sticky top-0 h-screen flex items-center"> {/* PINNED */}
    <div className="mx-auto max-w-6xl w-full px-6 grid lg:grid-cols-2 gap-12 items-center">
      <LeftPanel scrollYProgress={scrollYProgress} />
      <RightPipeline steps={steps} activeStep={activeStep} stepProgress={stepProgress} />
    </div>
  </div>
</section>
```

Key behaviors to implement:
- **NO `overflow-y-auto`** on any inner container. The browser's native scroll drives everything.
- The `sticky` container pins the visualization while the user scrolls; reverse scroll automatically rewinds because `scrollYProgress` is bidirectional.
- The active step transitions smoothly via `useMotionValueEvent(activeStep, 'change', setActive)`.
- The vertical connector between steps fills based on `stepProgress` (per active step) — use `<motion.div style={{ scaleY: stepProgress }} />` with `transformOrigin: 'top'`.
- The pipeline badge ribbon at top animates each node as `activeStep` advances.
- Add a **floating step counter** at bottom‑right of the sticky frame: `01 / 06` with `tabular-nums`.
- Add a **vertical scroll progress rail** on the left edge of the sticky frame (3px wide bar that fills with the gold gradient).

### 3.3 Reduced‑motion + mobile fallback
- If `useReducedMotion() === true` → render the **classic stacked list** (no pinning, no scroll‑scrubbing, just `whileInView` per step).
- On `< lg` viewports → also render the stacked list (pinning on mobile feels broken because of small viewport height).

### 3.4 Smooth scroll baseline (OPTIONAL but recommended)
Add **Lenis** for buttery‑smooth native scroll:
```bash
npm i @studio-freight/lenis
```
Wire it once in `OverviewPage`:
```tsx
useEffect(() => {
  if (prefersReducedMotion) return;
  const lenis = new Lenis({ duration: 1.2, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
  const raf = (time: number) => { lenis.raf(time); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  return () => lenis.destroy();
}, [prefersReducedMotion]);
```
**Important**: Lenis must respect `prefers-reduced-motion` (skip init when true) and must NOT be applied to the auth/classroom pages.

### 3.5 Apply the same pattern to ONE more high‑value section
Use scroll‑scrubbing on **Hero → Features transition**:
- Hero text scales from 1 → 1.05 and fades out as user scrolls
- A "scroll indicator" arrow at hero bottom fades out
- Background gradient parallax‑shifts at half scroll speed (`y: useTransform(scrollY, [0, 800], [0, -200])`)

---

## ✨ PHASE 4 — Section‑by‑Section UI Polish

### 4.1 Hero
- Add an **animated tagline rotator** under the headline ("real‑time voice", "curriculum‑aware", "lifelike 3D"). Cycle every 2.5s with a 200ms fade.
- Replace the static screenshot with a **3‑layer parallax stack**: avatar render + UI chrome + ambient glow, each moving at different scroll speeds.
- Add a **"trusted by" logo strip** below the CTAs (5‑7 grayscale logos at 40% opacity, hover to 100%).
- The primary CTA gets a **subtle gold‑tinted glow on hover** (`hover:shadow-[0_0_40px_-8px_rgba(180,171,139,0.6)]`).
- Add a **subtle animated cursor / scroll indicator** at the bottom.

### 4.2 Features
- Replace the boring vertical list with an **alternating zig‑zag layout** OR a **bento grid** (3 large cards + 2 small) — bento is the 2024‑2026 SaaS standard.
- Each feature gets a **mini illustration** (use Lucide icons in a stylized frame, or generate small SVG illustrations).
- On hover: card lifts (`translate-y-[-4px]`), border shifts from `white/10` → `gold/40`, ambient glow appears.

### 4.3 Tech Stack
- **Add `category` field** to each tech item. Render as 4 tabs: `Frontend | Backend | AI/ML | Infrastructure`.
- Add a **marquee animation** (infinite horizontal scroll) for each category row, pauseable on hover.
- Each logo is grayscale by default, full color on hover, with a tooltip showing `name + role`.

### 4.4 Demo Preview
- Replace the static image with an **autoplaying muted looping video** of the actual app in action. If no video → use a **`<picture>` element** with `srcset` for 1x/2x/3x.
- Add a **device frame mockup** (MacBook or browser chrome) around the demo.
- Add **floating "live" annotations** that point to features in the demo (e.g., "← voice waveform", "← lip‑synced avatar").

### 4.5 NEW SECTIONS to add (in this order between TechStack and Footer)
1. **Stats / Social Proof** — 4 metric cards: "<200ms voice latency", "6‑stage pipeline", "3D lip‑sync at 60fps", "Privacy‑first architecture". Count‑up animation on view.
2. **Testimonials** — 3 cards (even if placeholder: "Student", "Professor", "Researcher" quotes). Slide‑in carousel on mobile.
3. **FAQ** — `<details><summary>` accordion with 6‑8 questions. Native HTML for accessibility, styled with Tailwind.
4. **Final CTA section** — full‑width gradient panel ("Ready to deploy your AI TA?") with 2 buttons (primary CTA + "Schedule a demo").

### 4.6 Footer (expand it significantly)
Current footer is a team grid + copyright — way too thin. New layout:
- 4‑column grid: `[Logo + tagline + social] [Product links] [Resources] [Legal]`
- Below: full‑width team strip (current grid)
- Bottom bar: copyright, status badge ("● All systems operational"), language switcher placeholder

### 4.7 Splash Screen
- **Shorten to 1.6s max** and respect `prefers-reduced-motion` (skip entirely).
- Replace the static glow ring with an animated `VirtAI` wordmark that draws stroke‑by‑stroke (use `<motion.path strokeDasharray />`).
- Add a 1‑line tagline that fades in at 800ms.
- Skip splash entirely on return visits (already does via `sessionStorage` — keep this).

### 4.8 Navbar
- Add a **mini logo glyph** next to the wordmark.
- Active link gets the gold underline (already done) — also add a subtle background tint `bg-gold/5`.
- On scroll, the navbar background shifts from `dark/80` → `dark/95` with `backdrop-blur-xl`.
- Add a **"Theme" toggle** placeholder (even if non‑functional — shows polish).

---

## 🧪 PHASE 5 — Performance, A11y, and QA

### 5.1 Performance
- Wrap `TimelineStep`, `FeatureCard`, tech items in `React.memo`.
- Use `Intersection Observer` with `rootMargin: '200px'` to pre‑warm lazy components.
- Audit the canvas: skip drawing pulses whose tail is off‑screen. Cap `pulseCount` to 6 on mobile.
- Preload the hero image with `<link rel="preload" as="image" href="/assets/images/image.webp" fetchpriority="high">`.
- Add `loading="eager"` + `fetchpriority="high"` to hero image, `loading="lazy"` to everything below the fold.

### 5.2 Accessibility
- Add **focus trap** to mobile menu (use `focus-trap-react` — 5KB).
- Add `aria-live="polite"` to the active pipeline step announcement (`Step {N} of 6: {label}`).
- Ensure all interactive elements have a visible `focus-visible` ring (already partial — audit every button/link).
- Run Lighthouse → target **A11y score ≥ 95**.
- Add `prefers-reduced-data` respect: skip the circuit board canvas entirely.

### 5.3 Final QA Checklist
- [ ] Lighthouse Performance ≥ 90, A11y ≥ 95, Best Practices ≥ 95
- [ ] No console errors / warnings in dev or prod
- [ ] All TS strict mode errors resolved (no `@ts-ignore`)
- [ ] Tested on Chrome, Safari, Firefox, mobile Safari, mobile Chrome
- [ ] `prefers-reduced-motion` actually disables ALL animations
- [ ] Tab navigation works through every interactive element
- [ ] Mobile menu traps focus and closes on Esc
- [ ] Scroll‑pinning section reverses correctly when scrolling up
- [ ] Page works with JS disabled (graceful degradation — at least the content is readable)

---

## 📦 DEPENDENCIES TO ADD

```bash
npm i @studio-freight/lenis focus-trap-react clsx tailwind-merge
# (clsx & tailwind-merge probably already installed — verify)
```

**DO NOT** add GSAP unless the Framer Motion approach proves insufficient. Framer is already a dependency and is enough for everything described above.

---

## 📐 DELIVERABLE FORMAT

Work in **this exact phase order**: Phase 1 (split) → Phase 2 (design system) → Phase 3 (scroll animation) → Phase 4 (section polish) → Phase 5 (perf + a11y).

For each file you change:
1. Show the full new content (or a clear diff if the change is < 30 lines).
2. Explain WHY the change improves the codebase.
3. Note any new files created and their purpose.

For the scroll‑pinning implementation specifically, include a short demo paragraph explaining the math: "scroll progress 0–1 maps to step index 0–5, sticky container is 700vh tall so each step gets ~117vh of scroll distance, etc."

---

## 🚫 EXPLICIT ANTI‑PATTERNS TO REMOVE

- ❌ `style={{ fontFamily: 'var(--font-display)' }}` — use a Tailwind class.
- ❌ Inline `as unknown as` casts — declare proper interfaces.
- ❌ `MutationObserver` in `Navbar` — use a layout effect after sections mount.
- ❌ `overflow-y-auto max-h-[60vh]` in `HowItWorks` — replaced by sticky/pinned section.
- ❌ Mixed `motion/react` and `framer-motion` imports — pick `framer-motion` everywhere.
- ❌ Untyped `stepRefs.current = []` — use `useRef<(HTMLLIElement | null)[]>([])`.
- ❌ Long `useEffect` blocks doing 3+ unrelated things in `OverviewPage` — extract hooks.

---

## 🎯 SUCCESS CRITERIA

When you're done, the landing page should:
1. Feel like **Linear.app** or **Anthropic.com** — minimal, confident, precise.
2. Have the `HowItWorks` section behave like **Apple's product pages** (scroll‑pinned with reverse).
3. Score **≥ 90 on Lighthouse Performance** and **≥ 95 on A11y**.
4. Be **fully typed** with `tsc --strict --noEmit` passing.
5. Have **every file < 200 LOC** (with rare justified exceptions).
6. Use **a coherent design system** (typography, colors, spacing tokens all in `tailwind.config.js`).

Now begin Phase 1.
````

---

## 💡 Additional Notes for You

**1. About the scroll‑jacking you asked about:**  
The technical term is **"Section Pinning + Scroll‑Scrubbed Animation"** (style of Apple, Linear, Stripe, Vercel, Anthropic). The prompt details two approaches:

- **Preferred method**: `framer-motion` + CSS `position: sticky` + `useScroll` (no extra libraries, reverse works automatically).
- **Strong alternative**: GSAP ScrollTrigger (more powerful but heavier).
- **Optional addition**: `Lenis` for general smooth scrolling on the page (makes scrubbing feel like silk).

**2. About fonts:**  
I recommended **`Instrument Serif` + `Inter Variable` + `JetBrains Mono`** — a known combo that gives a professional/premium SaaS feel. Alternatives if you prefer: `General Sans`, `Satoshi`, `Cal Sans` for display.

**3. About adding new sections:**  
The current landing page is missing 4 important sections for any premium SaaS: **Stats, Testimonials, FAQ, Final CTA**. I added them in Phase 4.5.

**4. Incremental execution:**  
The prompt is split into 5 phases so the Agent can execute step‑by‑step instead of trying everything at once. Each phase has measurable outcomes.

If you need any adjustment to the prompt (e.g., use GSAP instead of Framer for scroll animation, or remove certain sections), just tell me and I'll adjust it.
