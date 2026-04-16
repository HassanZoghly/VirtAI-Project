# Docker Development Hot-Reload Design

Date: 2026-04-16
Scope: Development-only Docker workflow for frontend/backend with live reload from host edits.

## Problem

Current Docker setup is optimized around image build/startup and does not mount source code for true inner-loop development. The requirement is a dev-only setup where editing files on the host reflects immediately inside running containers, without rebuilding images on each change.

## Constraints

1. Do not optimize for production behavior in this path.
2. Use bind mounts for source code:
   - `./frontend:/app`
   - `./backend:/app`
3. Prevent frontend dependency overwrite with anonymous volume:
   - `/app/node_modules`
4. Frontend must run dev server (not build):
   - `npm run dev`
   - listen on `0.0.0.0`
   - enable polling env
5. Backend must run auto-reload:
   - `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`
6. Keep ports exposed for local development.
7. Avoid requiring rebuild on every code change.

## Chosen Approach

Approach A (approved): add a separate `docker-compose.dev.yml` override while keeping `docker-compose.yml` intact.

Why:
- Lowest risk and least invasive to existing setup.
- Clear dev-only path without mixing production-like defaults into the base compose.
- Works naturally with `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`.

## Design

### 1. Compose layering model

- Keep `docker-compose.yml` as the base.
- Add `docker-compose.dev.yml` for overrides to `frontend` and `backend` services:
  - `command` switched to dev commands.
  - bind mounts for source trees.
  - hot-reload env vars.
  - frontend anonymous `/app/node_modules` volume.

### 2. Backend dev behavior

- Service command in dev override:
  - `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`
- Add watch reliability env:
  - `WATCHFILES_FORCE_POLLING=true`
- Bind mount:
  - `./backend:/app`
- Keep existing backend data volume mount (`/app/.data`) to preserve runtime local artifacts.

### 3. Frontend dev behavior

- Service command in dev override:
  - `npm run dev -- --host 0.0.0.0 --port 3000`
- Bind mount:
  - `./frontend:/app`
- Anonymous volume:
  - `/app/node_modules`
- Add poll-based watch env:
  - `CHOKIDAR_USEPOLLING=true`
  - `CHOKIDAR_INTERVAL=300`

### 4. Dockerfiles (dev-friendly usage)

- Keep Dockerfiles simple and dependency-focused.
- Ensure they install dependencies and set `WORKDIR`.
- Do not rely on baked source for runtime behavior in dev path because bind mounts override app files.
- No production build commands (`npm run build`) in the dev execution path.

### 5. Developer workflow

Run:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Expected result:
- Editing files under `frontend/` or `backend/` updates running services via Vite/uvicorn reload.
- No image rebuild required for normal code edits.

## Files to change

1. `docker-compose.dev.yml` (new)
2. `frontend/Dockerfile` (dev-friendly dependency-focused baseline)
3. `backend/Dockerfile` (dev-friendly dependency-focused baseline)

## Error handling and edge cases

- Preserve existing `depends_on` and health-check orchestration from base compose.
- If host/FS watcher misses events, polling envs are enabled by default for reliability.
- Frontend dependency isolation through `/app/node_modules` prevents host bind mount from erasing container-installed modules.

## Verification plan

1. Bring stack up with layered compose command.
2. Edit a frontend file and verify immediate browser update.
3. Edit a backend endpoint file and verify uvicorn auto-reload + changed response.
4. Confirm no rebuild is needed for iterative edits.
5. Confirm MongoDB/Redis connectivity remains intact in dev run.
