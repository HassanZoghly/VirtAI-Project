# Skill Index System:

# Frontend Skill Index System

## Repo Context

- `frontend/` is a React SPA on `react@18.3.1`, `vite@7.3.1`, `tailwindcss@4.2.1`, and `vitest@4.0.18`.
- The repo uses raw `@react-three/fiber`, `@react-three/drei`, and `three` in `frontend/src/features/avatar/`; it does **not** currently use `@json-render/react-three-fiber`.
- This means:
  - `tailwind-css-patterns`, `vite`, and `vitest` are first-class fits for the current stack.
  - `vercel-react-best-practices` applies broadly for React performance, but Next.js/RSC/Server Action rules are conditional, not default.
  - `vercel-composition-patterns` is useful, but the React 19 rule is version-gated because the app is on React 18.3.
  - `react-three-fiber` is only relevant for spec-driven/json-render 3D work, not for the repo's normal raw R3F scene code.

## Priority System

- Primary skills: `frontend-design`, `tailwind-css-patterns`, `vercel-react-best-practices`, `accessibility`
  - Evaluate these first for any user-visible frontend task.
  - Do **not** apply all four blindly; use the smallest relevant set.
- Conditional support skills: `vercel-composition-patterns`, `typescript-advanced-types`, `vite`, `vitest`
  - Add these only when the task is clearly about component architecture, type systems, build config, or tests.
- Secondary 3D skills: `react-three-fiber`, `threejs-*`
  - Use only for scene/canvas/mesh/material/animation/interactions work.
- Ignore unless needed: `nodejs-backend-patterns`, `nodejs-best-practices`, `seo`
  - Keep these out of default frontend execution unless the task explicitly crosses into backend architecture or public search visibility.

## Skill Routing Rules

- New user-visible page, section, or component: `frontend-design` -> `tailwind-css-patterns` -> `accessibility`
  - Add `vercel-react-best-practices` if state, data loading, hydration, or bundle size are involved.
- UI layout, spacing, visual hierarchy, typography, or overall look: `frontend-design`
- Tailwind styling, responsive behavior, spacing scales, dark mode, theme tokens, container queries: `tailwind-css-patterns`
- Forms, focus behavior, keyboard interaction, semantics, screen reader support, motion reduction, error messaging: `accessibility`
- React rendering performance, data waterfalls, bundle size, hydration issues, rerenders, client/server boundaries: `vercel-react-best-practices`
- Reusable component API design, boolean prop sprawl, compound components, shared subcomponent state: `vercel-composition-patterns`
- Advanced generic props, inferred utility types, typed configuration, type-level guarantees: `typescript-advanced-types`
- `vite.config.*`, environment loading, plugin authoring, build output, SSR build, Vite migration work: `vite`
- `*.test.*`, mocks, jsdom/happy-dom, coverage, filtering, fixtures, type tests: `vitest`
- Files under `frontend/src/features/avatar/` or code using `Canvas`, `useFrame`, `useGLTF`, `useFBX`, or `three`: `threejs-fundamentals` plus only the needed `threejs-*` modules
- JSON/spec-driven 3D catalogs or `@json-render/react-three-fiber`: `react-three-fiber`
- 3D mesh creation or vertex work: `threejs-geometry`
- 3D materials, PBR, env maps, shader-vs-material choices: `threejs-materials`
- 3D lighting, shadows, IBL, PMREM: `threejs-lighting`
- 3D loading pipelines for GLTF, HDRI, textures, progress handling: `threejs-loaders`
- 3D texture mapping, UVs, compression, render targets: `threejs-textures`
- Custom GLSL, uniforms, varyings, material extension: `threejs-shaders`
- GLTF clips, mixers, morph targets, procedural motion: `threejs-animation`
- Raycasting, controls, selection, screen/world mapping: `threejs-interaction`
- Bloom, FXAA/SMAA, SSAO, DOF, screen-space finishing: `threejs-postprocessing`
- Public marketing discoverability, metadata, structured data, sitemap, robots, canonicals: `seo`
- Express/Fastify/API/service-layer/backend architecture: `nodejs-backend-patterns` or `nodejs-best-practices`

## Skill Index

### `frontend-design`

- Priority: Primary
- Purpose: Drive the visual direction of user-facing UI so outputs feel designed rather than generated.
- Scope: Pages, dashboards, landing sections, components, layout systems, visual refreshes.
- Key patterns: Commit to a bold aesthetic direction first; use distinctive typography; avoid generic font stacks and purple-on-white defaults; make motion intentional; use atmospheric backgrounds, asymmetry, and visual tension.
- Use when: The task changes how the interface looks, feels, or communicates hierarchy.
- Avoid when: The task is test-only, config-only, backend-only, or purely invisible logic.

### `tailwind-css-patterns`

- Priority: Primary
- Purpose: Implement UI styling in Tailwind with strong responsive, configuration, performance, and accessibility defaults.
- Scope: Utility composition, layout, spacing, dark mode, Tailwind v4.1+ theme/config, container queries, animation utilities.
- Key patterns: Mobile-first classes; compose utilities over `@apply`; use design tokens and `@theme`; configure content scanning correctly; use motion-safe/motion-reduce; keep reusable class patterns readable.
- Use when: The task is about styling, layout, breakpoints, spacing systems, or Tailwind configuration.
- Avoid when: The stack is not Tailwind, or the real problem is component API design, accessibility semantics, or React rendering behavior.

### `vercel-react-best-practices`

- Priority: Primary
- Purpose: Prevent React/Next.js performance regressions and guide async, rendering, bundle, and rerender decisions.
- Scope: Async waterfalls, bundle size, server/client boundaries, rerenders, hydration, rendering performance, JS hot paths.
- Key patterns: Parallelize independent async work; avoid barrel imports; lazy-load heavy code; keep request data local; minimize serialization; move user-triggered side effects into events; use transitions, deferred values, refs, and derived state correctly.
- Use when: A React task touches data fetching, component performance, hydration, rerender frequency, bundle cost, or expensive client work.
- Avoid when: The task is purely visual CSS/markup with no runtime behavior, or when rules are Next.js/RSC-specific and the code is still a Vite SPA.
- Current repo note: Treat `server-*`, Server Action, `after()`, and RSC-specific rules as opt-in only if SSR or Next.js enters the stack.

### `accessibility`

- Priority: Primary
- Purpose: Enforce WCAG 2.2-oriented accessibility for interactive UI, content, and flows.
- Scope: Semantic HTML, keyboard access, focus management, screen readers, contrast, target sizing, reduced motion, errors, auth flows.
- Key patterns: Prefer native elements over ARIA; provide alt text and labels; keep focus visible and unobscured; add skip links; meet contrast targets; support drag alternatives and minimum target sizes; announce dynamic updates with live regions.
- Use when: The task affects forms, buttons, menus, dialogs, media, navigation, auth, or any user-facing interaction.
- Avoid when: The change is fully internal and non-UI, though any touched UI should still be checked against this skill.

### `vercel-composition-patterns`

- Priority: Conditional support
- Purpose: Fix component architecture problems caused by prop sprawl and tightly coupled state.
- Scope: Compound components, provider patterns, variant APIs, context contracts, state lifting, dependency-injectable UI.
- Key patterns: Avoid boolean prop proliferation; prefer explicit variant components; use compound components with shared context; define context as `state`, `actions`, and `meta`; decouple UI from state implementation; prefer children over render props.
- Use when: A component is hard to extend, has many boolean flags, or needs shared state across reusable subcomponents.
- Avoid when: The component is small, leaf-level, and not suffering from API complexity.
- Current repo note: Skip the React 19 `ref`/`use()` guidance unless the app upgrades beyond React 18.

### `typescript-advanced-types`

- Priority: Conditional support
- Purpose: Solve advanced type-system problems without weakening safety with `any`.
- Scope: Generics, conditional types, mapped types, template literal types, inference helpers, type guards, type tests.
- Key patterns: Prefer `unknown` over `any`; use `infer` for extraction; encode relationships with conditional and mapped types; add type-level tests where the types matter; keep complexity proportional to the problem.
- Use when: A task requires reusable generic APIs, strict type transformations, or non-trivial type inference.
- Avoid when: Simple props/interfaces are enough; do not introduce type cleverness that hurts readability.

### `vite`

- Priority: Conditional support
- Purpose: Guide build-tool and config work in Vite projects.
- Scope: `vite.config.ts`, `defineConfig`, `loadEnv`, `import.meta.glob`, plugin hooks, library mode, SSR build, multi-environment config.
- Key patterns: Use TypeScript config and ESM; use `loadEnv` inside config; keep paths analyzable; know the difference between app config and environment-specific overrides; use Vite-native features before custom build hacks.
- Use when: The task changes build config, aliases, env loading, plugins, Vite SSR, or migration behavior.
- Avoid when: The issue is purely app code and not caused by Vite.
- Current repo note: The skill includes Vite 8 Rolldown guidance, but the repo is on Vite 7.3.1, so `rolldownOptions` and Oxc migration advice are upgrade-only.

### `vitest`

- Priority: Conditional support
- Purpose: Standardize test authoring and test-runner configuration for this Vite-based frontend.
- Scope: Unit tests, environment setup, mocks, snapshots, fixtures, coverage, filtering, concurrency, project configs, type tests.
- Key patterns: Use the right environment (`node`, `jsdom`, `happy-dom`); use `vi` for mocks and spies; use filtering and related-test commands to stay fast; keep coverage and setup explicit; use `.test-d.ts` for type checks when needed.
- Use when: The task creates or changes tests, mocking behavior, coverage, or test config.
- Avoid when: The task is runtime app logic only and no tests/config are being touched.

### `react-three-fiber`

- Priority: Secondary 3D
- Purpose: Support spec-driven 3D scenes rendered through `@json-render/react-three-fiber`.
- Scope: Catalog definitions, registry wiring, `ThreeCanvas`, `ThreeRenderer`, flat scene specs, reusable Zod schemas for scene props.
- Key patterns: Separate server-safe catalog definitions from runtime implementations; map only the components you need; keep specs flat and declarative; use the shared material/transform schemas.
- Use when: The task is explicitly about JSON-render catalogs or scene specs.
- Avoid when: Editing the current repo's normal `@react-three/fiber` components; use `threejs-*` plus local R3F code instead.

### `threejs-fundamentals`

- Priority: Secondary 3D
- Purpose: Establish correct scene, camera, renderer, transform, and hierarchy setup.
- Scope: Scene bootstrapping, camera choice, renderer configuration, resize handling, coordinate systems, Object3D patterns.
- Key patterns: Set sensible pixel ratio limits; update camera and renderer on resize; choose the right camera model; manage transforms through Object3D hierarchy; configure tone mapping and shadows intentionally.
- Use when: Starting or reshaping any 3D scene or troubleshooting scene-level behavior.
- Avoid when: The scene scaffold is already correct and the task is only about a specialized concern such as shaders or post-processing.

### `threejs-geometry`

- Priority: Secondary 3D
- Purpose: Create or optimize mesh shape data.
- Scope: Built-in geometry, `BufferGeometry`, custom vertices, text geometry, points, lines, instancing.
- Key patterns: Prefer built-in geometry first; use `BufferGeometry` for custom data; use instancing for repeated meshes; keep normals/UVs/indexes coherent; avoid rebuilding heavy geometry every frame.
- Use when: The task changes shape generation, mesh topology, vertices, or repeated object rendering.
- Avoid when: The real issue is material appearance, lighting, or animation rather than mesh data.

### `threejs-materials`

- Priority: Secondary 3D
- Purpose: Choose and tune the correct material model for the visual goal and performance budget.
- Scope: Unlit materials, PBR, physical materials, toon styles, shader materials, env maps, shared material behavior.
- Key patterns: Prefer `MeshStandardMaterial` for realistic work; use `MeshPhysicalMaterial` only when its features matter; know when `MeshBasicMaterial` is enough; share materials when possible; keep texture channels and UV requirements aligned.
- Use when: A task changes surface appearance, reflectance, transparency, or material realism.
- Avoid when: The needed change is actually in lighting, texture loading, or geometry.

### `threejs-lighting`

- Priority: Secondary 3D
- Purpose: Configure believable and performant illumination.
- Scope: Light types, shadow setup, helpers, image-based lighting, common lighting rigs, light animation.
- Key patterns: Pick the cheapest light that solves the scene; tune shadow map size and bias carefully; use environment lighting for PBR scenes; debug with helpers before guessing.
- Use when: The scene is flat, unreadable, overexpensive, or needs shadows/IBL.
- Avoid when: The visual problem comes from materials, post-processing, or bad textures rather than lighting.

### `threejs-loaders`

- Priority: Secondary 3D
- Purpose: Load models, HDRIs, and textures reliably.
- Scope: `LoadingManager`, GLTF/GLB, texture loading, HDR/EXR, async loading, caching, source handling, load errors.
- Key patterns: Centralize load progress with `LoadingManager`; prefer promise-based loading for orchestration; configure HDR environment loading correctly; cache or reuse expensive assets; surface errors instead of silent failures.
- Use when: A task adds or changes external 3D assets or loading lifecycle behavior.
- Avoid when: Assets are already in memory and the task is about rendering, interaction, or materials.

### `threejs-textures`

- Priority: Secondary 3D
- Purpose: Configure texture data correctly for quality and performance.
- Scope: Color spaces, wrapping, filtering, anisotropy, cube maps, HDR textures, UV mapping, render targets, procedural and compressed textures.
- Key patterns: Use sRGB for color maps and leave data maps linear; configure wrapping/filtering intentionally; manage anisotropy and mipmaps; understand UV requirements; dispose of large textures and render targets.
- Use when: The task touches image-based detail, UV mapping, environment maps, or texture memory problems.
- Avoid when: Surface appearance can be solved by material parameters alone.

### `threejs-shaders`

- Priority: Secondary 3D
- Purpose: Implement effects that built-in materials cannot express.
- Scope: `ShaderMaterial`, `RawShaderMaterial`, uniforms, varyings, material extension, instanced shaders, debugging GLSL.
- Key patterns: Use `ShaderMaterial` unless full raw control is required; keep uniform updates explicit; pass only the data the fragment stage needs; extend built-in materials before rewriting everything from scratch.
- Use when: The task requires custom distortion, procedural visuals, bespoke lighting math, or shader-driven animation.
- Avoid when: A built-in material, texture, or post-processing pass can solve the problem more simply.

### `threejs-animation`

- Priority: Secondary 3D
- Purpose: Drive time-based motion for objects, rigs, and morph targets.
- Scope: `AnimationClip`, `AnimationMixer`, `AnimationAction`, GLTF animations, skeletal animation, blending, procedural motion.
- Key patterns: Update mixers every frame with clock delta; crossfade between actions instead of hard switching; keep procedural motion separate from imported clips when possible; clamp or reset actions intentionally.
- Use when: The task changes motion timing, GLTF animation playback, blend behavior, or morph target control.
- Avoid when: The task is purely about interaction, loading, or static scene composition.

### `threejs-interaction`

- Priority: Secondary 3D
- Purpose: Handle user input inside 3D scenes.
- Scope: Raycasting, camera controls, selection systems, drag controls, keyboard input, coordinate conversion, interaction performance.
- Key patterns: Convert pointer coords relative to the canvas, not the window; raycast only against relevant objects/layers; throttle hover work; update controls in the render loop when required.
- Use when: The task involves picking, camera movement, object selection, or direct user manipulation in 3D.
- Avoid when: The scene is non-interactive or the issue is purely visual.

### `threejs-postprocessing`

- Priority: Secondary 3D
- Purpose: Add screen-space finishing effects after the base scene render.
- Scope: `EffectComposer`, bloom, AA, SSAO, DOF, custom passes, multi-pass rendering.
- Key patterns: Start with a clean base render; add only the passes that materially improve the result; remember resize handling for composer and passes; treat post as a performance tradeoff, not a default.
- Use when: The task explicitly needs glow, blur, AO, anti-aliasing, grading, or stylized screen-space effects.
- Avoid when: The frame budget is already tight or the issue should be fixed in geometry, materials, or lighting first.

### `nodejs-backend-patterns`

- Priority: Ignore unless needed
- Purpose: Provide concrete backend implementation patterns for Node services.
- Scope: Express/Fastify setup, layered architecture, middleware, error handling, DB integration, auth, caching, response formats, backend testing.
- Key patterns: Separate controllers/services/repositories; centralize errors; validate inputs at boundaries; encapsulate database access; keep auth and caching explicit.
- Use when: The frontend task expands into a real Node API or service layer.
- Avoid when: The work is confined to client-side UI or browser behavior.

### `nodejs-best-practices`

- Priority: Ignore unless needed
- Purpose: Guide backend architectural decisions rather than provide fixed code patterns.
- Scope: Framework selection, runtime/module strategy, async model, security, testing, anti-pattern avoidance.
- Key patterns: Choose framework by deployment target and team constraints; validate at boundaries; separate I/O-bound from CPU-bound work; centralize errors; ask for preferences when tradeoffs matter.
- Use when: The problem is architectural decision-making for a Node backend.
- Avoid when: You already know the backend stack and need concrete implementation patterns more than decision trees.

### `seo`

- Priority: Ignore unless needed
- Purpose: Improve public-page discoverability and search engine clarity.
- Scope: Meta tags, headings, canonicals, robots, sitemap, structured data, mobile SEO, international SEO, audit checklists.
- Key patterns: Keep titles and descriptions unique; use canonical URLs; add JSON-LD where appropriate; preserve crawlable structure; only optimize indexable public pages.
- Use when: The task is explicitly about public search visibility, metadata, or schema.
- Avoid when: The page is internal, authenticated, app-only, or not intended for indexing.
- Current repo note: If SEO work is needed, pair this with `react-helmet-async` implementation decisions in the app.

## How to Use This Index

Before implementing any frontend feature:

1. Identify the task type: UI, styling, accessibility, React behavior, 3D, build config, tests, backend crossover, or SEO.
2. Select the matching skills using the routing rules above.
3. Apply only the relevant skills; do not load the entire skill library for a narrow task.
4. Follow the selected skill rules strictly, especially the "avoid when" guards.
5. Check repo-specific version gates before applying advanced guidance:
   - React 18.3: do not assume React 19 APIs.
   - Vite 7.3: treat Rolldown migration rules as upgrade-only.
   - Raw R3F in `frontend/src/features/avatar/`: prefer `threejs-*` over the json-render `react-three-fiber` skill.

## Default Decision Patterns

- Standard visible React UI work: `frontend-design` + `tailwind-css-patterns` + `accessibility`
  - Add `vercel-react-best-practices` if the change touches state, effects, async work, or bundle cost.
- Component library or reusable composite widget work: `vercel-composition-patterns` + `accessibility`
  - Add `tailwind-css-patterns` if the component is Tailwind-styled.
- Performance/debugging pass on existing React code: `vercel-react-best-practices`
- 3D avatar or canvas work in this repo: `threejs-fundamentals` + only the exact `threejs-*` specializations involved
- Build/test infrastructure work: `vite` and/or `vitest`
- Public metadata/discoverability work: `seo`

----------

# Backend Skill Index System

## Backend Architecture Mapping

- domain/
  → python-patterns
  → business logic rules only (no external deps)

- application/
  → python-patterns
  → orchestration logic

- infrastructure/
  → sqlalchemy-orm
  → fastapi integrations
  → external services (ASR, TTS, LLM)

- presentation/
  → fastapi-python
  → fastapi-templates

## Database Rules

- Use sqlalchemy-orm for all DB interactions
- Follow sqlalchemy-alembic-expert-best-practices-code-review strictly:
  - indexes must match query patterns
  - avoid unsafe column changes
  - split constraints properly
  - use concurrent indexes when needed

## Testing Strategy

- Use python-testing-patterns
- Focus on:
  - domain logic tests (pure)
  - integration tests (API + DB)
- Avoid over-mocking

## Backend Skill Routing Rules

- API / endpoints → fastapi-python
- Request/response validation → pydantic
- Business logic → python-patterns
- DB operations → sqlalchemy-orm
- Migrations / schema changes → sqlalchemy-alembic-expert-best-practices-code-review
- Background or execution logic → python-executor
- Testing → python-testing-patterns

## Priority System

* Core:
  * python-patterns
  * fastapi-python
  * pydantic
  * sqlalchemy-orm

* Advanced:
  * sqlalchemy-alembic-expert-best-practices-code-review
  * python-testing-patterns

## Backend Usage Workflow

Before implementing:

1. Identify layer (domain / application / infrastructure / presentation)
2. Select skill based on routing rules
3. Apply constraints from SKILL.md
4. Ensure separation of concerns (Clean Architecture)

## Skill Index

### `fastapi-python`
- Purpose: Expert in FastAPI and Python backend development with best practices for APIs and async operations.
- Layer: presentation
- Use when: Writing FastAPI route handlers, controllers, and endpoints.
- Avoid when: Writing generic business logic (domain) that doesn't touch HTTP.
- Key rules: 
  - Favor functional, declarative programming over class-based approaches.
  - Follow the Receive an Object, Return an Object (RORO) pattern.
  - Explicitly export routes and utilities.

### `fastapi-templates`
- Purpose: Production-ready FastAPI project structures with async patterns and dependency injection.
- Layer: presentation / infrastructure
- Use when: Starting new FastAPI projects or scaffolding API services.
- Avoid when: Writing pure domain logic.
- Key rules:
  - Standardize router structure in app/api/, services in app/services/, repositories in app/repositories/.
  - Utilize FastAPI dependency injection exclusively.

### `pydantic`
- Purpose: Python data validation using type hints and runtime type checking for high-performance validation.
- Layer: schemas / validation
- Use when: API request/response validation, configuration management, and ORM model deserialization.
- Avoid when: Executing pure business logic calculation unrelated to schema shaping.
- Key rules:
  - Use Pydantic v2 core methods.
  - Employ strict mode and annotations where allowed.

### `python-executor`
- Purpose: Execute Python code in a safe sandboxed environment.
- Layer: background / external execution
- Use when: Executing isolated data processing, web scraping, image/video manipulation, or external API tasks.
- Avoid when: Regular synchronous backend API processing.
- Key rules:
  - Use safely for isolated computations; it runs CPU-only without GPU machine learning.

### `python-patterns`
- Purpose: Pythonic idioms, PEP 8 standards, and type hints for robust applications.
- Layer: domain / application / everywhere
- Use when: Writing new Python code, reviewing Python code, or refactoring existing Python code.
- Avoid when: Relying on framework-specific nuances instead of core Python patterns.
- Key rules:
  - Explicit is better than implicit.
  - Apply Easier to Ask Forgiveness Than Permission (EAFP).
  - Implement precise type hints and avoid bare exceptions or generic `any`.

### `python-testing-patterns`
- Purpose: Comprehensive testing strategies using pytest, fixtures, and TDD.
- Layer: testing
- Use when: Setting up tests, implementing testing scenarios, mocking database components.
- Avoid when: Writing application execution layer code.
- Key rules:
  - Follow Arrange, Act, Assert (AAA).
  - Ensure test isolation without shared state.
  - Only test one behavior per module.

### `sqlalchemy-alembic-expert-best-practices-code-review`
- Purpose: Safe and robust SQLAlchemy ORM and Alembic schema migration methodologies.
- Layer: infrastructure (schema updates)
- Use when: Creating and reviewing Alembic database migrations or modifying data schema files.
- Avoid when: The updates only interact with Python and don't involve database mutations.
- Key rules:
  - Always deploy concurrent indexes (`postgresql_concurrently=True`).
  - Add constraints safely via a split implementation process (e.g. constraints with `NOT VALID` first).

### `sqlalchemy-orm`
- Purpose: Complex SQL queries, data type safety, and entity relationship mapping via SQLAlchemy 2.0.
- Layer: infrastructure (data access)
- Use when: Interacting with databases, configuring relations, and mapping persistent data.
- Avoid when: Code belongs to pure business application models independent of database details.
- Key rules:
  - Use modern SQLAlchemy API syntax such as `select()` alongside session context managers.
  - Avoid N+1 requests with correct eager loading strategies (`selectinload`, `joinedload`).