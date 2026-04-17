# Docker Dev Hot-Reload Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a development-only Docker workflow where frontend and backend reflect host code edits immediately without rebuilding images for each change.

**Architecture:** Keep `docker-compose.yml` as the base stack and add a `docker-compose.dev.yml` override for development runtime behavior. Use bind mounts for source, an anonymous frontend `node_modules` volume, and dev commands (`npm run dev`, `uvicorn --reload`) so code changes propagate instantly inside running containers.

**Tech Stack:** Docker Compose, Node 20 + Vite, Python 3.10 + FastAPI/Uvicorn, MongoDB, Redis

---

## File Structure (locked before implementation)

- **Create:** `docker-compose.dev.yml`
  - Responsibility: development-only overrides (bind mounts, hot-reload commands, watcher env vars).
- **Modify:** `frontend/Dockerfile`
  - Responsibility: dev-friendly image baseline for dependency install + Vite dev startup defaults.
- **Modify:** `backend/Dockerfile`
  - Responsibility: dev-friendly image baseline for dependency install + uvicorn reload defaults.
- **Modify:** `README.md`
  - Responsibility: clear developer command for layered compose and hot-reload behavior.

---

### Task 1: Add dev Compose override for bind mounts and hot reload

**Files:**
- Create: `docker-compose.dev.yml`
- Test: `docker compose -f docker-compose.yml -f docker-compose.dev.yml config`

- [ ] **Step 1: Write the failing check (dev override file does not exist yet)**

```bash
test -f docker-compose.dev.yml
```

Expected: exit code `1` (file missing).

- [ ] **Step 2: Create `docker-compose.dev.yml` with dev-only overrides**

```yaml
services:
  backend:
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    environment:
      WATCHFILES_FORCE_POLLING: "true"
      PYTHONDONTWRITEBYTECODE: "1"
      PYTHONUNBUFFERED: "1"
    volumes:
      - ./backend:/app
      - backend-data:/app/.data

  frontend:
    command: npm run dev -- --host 0.0.0.0 --port 3000
    environment:
      VITE_API_TARGET: http://backend:8000
      CHOKIDAR_USEPOLLING: "true"
      CHOKIDAR_INTERVAL: "300"
      WATCHPACK_POLLING: "true"
    volumes:
      - ./frontend:/app
      - /app/node_modules
```

- [ ] **Step 3: Validate merged compose configuration**

Run:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml config
```

Expected:
- Command succeeds.
- `backend` shows `./backend:/app` and `uvicorn ... --reload`.
- `frontend` shows `./frontend:/app`, `/app/node_modules`, and `npm run dev`.

- [ ] **Step 4: Commit Task 1**

```bash
git add docker-compose.dev.yml
git commit -m "feat(dev-docker): add compose override for bind mounts and hot reload"
```

---

### Task 2: Update frontend Dockerfile for dev-mode defaults

**Files:**
- Modify: `frontend/Dockerfile`
- Test: `docker compose -f docker-compose.yml -f docker-compose.dev.yml build frontend`

- [ ] **Step 1: Write the failing check (frontend command not standardized to npm script)**

```bash
grep -n 'CMD \["npm", "run", "dev"' frontend/Dockerfile
```

Expected: no match (exit code `1`).

- [ ] **Step 2: Update `frontend/Dockerfile`**

Replace file content with:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies in image layers; source is bind-mounted in dev.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]
```

- [ ] **Step 3: Build frontend image with dev override**

Run:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml build frontend
```

Expected: build succeeds with `npm ci` layer cached or rebuilt.

- [ ] **Step 4: Commit Task 2**

```bash
git add frontend/Dockerfile
git commit -m "chore(dev-docker): align frontend docker command with vite dev mode"
```

---

### Task 3: Update backend Dockerfile for auto-reload defaults

**Files:**
- Modify: `backend/Dockerfile`
- Test: `docker compose -f docker-compose.yml -f docker-compose.dev.yml build backend`

- [ ] **Step 1: Write the failing check (backend command missing --reload)**

```bash
grep -n -- '--reload' backend/Dockerfile
```

Expected: no match (exit code `1`).

- [ ] **Step 2: Update backend startup command**

Keep existing `backend/Dockerfile` structure and change only CMD to:

```dockerfile
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

- [ ] **Step 3: Build backend image**

Run:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml build backend
```

Expected: build succeeds and image metadata shows updated CMD.

- [ ] **Step 4: Commit Task 3**

```bash
git add backend/Dockerfile
git commit -m "chore(dev-docker): enable uvicorn reload in backend image defaults"
```

---

### Task 4: Document developer hot-reload workflow and verify runtime behavior

**Files:**
- Modify: `README.md`
- Test:
  - `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`
  - `docker compose logs -f frontend backend`

- [ ] **Step 1: Add README section for dev Docker workflow**

Add a section like this near setup/containers docs:

```md
## Development with Docker Hot Reload

Run the development stack with:

`docker compose -f docker-compose.yml -f docker-compose.dev.yml up`

This mode is development-only:
- Frontend runs `npm run dev` on `0.0.0.0:3000`
- Backend runs `uvicorn app.main:app --reload` on `0.0.0.0:8000`
- Source is bind-mounted from host (`./frontend`, `./backend`)
- Frontend uses anonymous `/app/node_modules` volume
```

- [ ] **Step 2: Bring up stack and validate watcher startup logs**

Run:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Expected log indicators:
- frontend: Vite dev server running and listening on `0.0.0.0:3000`
- backend: `Uvicorn running on http://0.0.0.0:8000` with reloader process

- [ ] **Step 3: Validate live reload behavior**

1. Edit any frontend file under `frontend/src/` and confirm browser refresh/HMR without container rebuild.
2. Edit any backend Python file under `backend/app/` and confirm uvicorn reload triggers automatically.

Expected:
- No `docker compose build` required after edits.
- Container processes remain up; only in-process reload occurs.

- [ ] **Step 4: Commit Task 4**

```bash
git add README.md
git commit -m "docs(dev-docker): document compose override hot-reload workflow"
```

---

## Final Verification Checklist

- [ ] `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` succeeds.
- [ ] `docker compose -f docker-compose.yml -f docker-compose.dev.yml build` succeeds.
- [ ] `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` starts all services healthy.
- [ ] Frontend edits reflect instantly without rebuilding.
- [ ] Backend edits reflect instantly without rebuilding.

---

## Self-Review (completed)

1. **Spec coverage:** All approved spec sections are mapped to tasks (compose override, Dockerfiles, env/watch polling, developer workflow).
2. **Placeholder scan:** No TODO/TBD placeholders remain.
3. **Type/command consistency:** Compose filenames, service names, commands, ports, and env var names are consistent throughout tasks.
