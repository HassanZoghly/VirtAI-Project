# Dev/Prod Docker Separation Design (2026-05-15)

## Summary
Refactor the Docker setup to make development default to the Vite dev server, keep production nginx/static serving isolated, and preserve runtime-neutral backend/container improvements. This keeps auth/cookie flows stable via the Vite proxy and avoids nginx in development.

## Goals
- Development uses Vite dev server only (no nginx in dev path).
- Keep Vite proxy as the sole /api router in development with same-origin behavior.
- Keep dev flow stable, minimal, and easy to debug.
- Preserve backend/container improvements that are runtime-neutral.
- Keep production nginx/static setup available but inactive in dev.

## Non-Goals
- No changes to application business logic, auth, or API routes.
- No changes to frontend source code unless required for Docker compatibility.
- No new reverse proxies or dev networking layers beyond Vite.

## Constraints
- Vite dev server must run with:
  - npm run dev
  - --host 0.0.0.0
  - --port 3000
- Keep VITE_API_TARGET=http://backend:8000 in dev compose.
- Preserve hot reload and polling behavior for bind mounts.
- Maintain healthchecks and depends_on ordering.

## File Responsibilities (Dev vs Prod)

### Development (active by default)
- frontend/Dockerfile.dev: Vite dev server runtime.
- docker-compose.yml: Development-oriented default compose.
- docker-compose.dev.yml: Dev-only overrides (bind mounts, node_modules volume).
- frontend/vite.config.js: Proxy + polling (unchanged behavior).

### Production (inactive in dev)
- frontend/Dockerfile.prod: Build + nginx runtime.
- frontend/nginx.conf: Static serving and caching rules.
- docker-compose.prod.yml: Prod-only overlay for frontend.

### Shared
- backend/Dockerfile: Runtime-neutral improvements and better caching.
- docker-compose.yml: Shared infra services (MongoDB, Redis, TTS, backend, frontend).

## Development Workflow

### Default (development-first)
- Command: docker compose up --build
- Uses docker-compose.yml only.
- Frontend runs Vite dev server (no nginx).

### Dev with bind mounts
- Command: docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
- Frontend bind-mounts project source.
- Anonymous volume keeps /app/node_modules from being overwritten.

## Production Workflow (future deployment)
- Command: docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
- Uses nginx static frontend runtime.
- Not used for development.

## Networking and Proxy Flow (Development)
- Browser -> http://localhost:3000 (Vite dev server)
- /api/* -> Vite proxy -> http://backend:8000
- Same-origin path keeps cookies/CSRF stable and supports credentials: "include".
- No nginx or other proxy layers in development.
- Nginx is production-only and never part of the dev auth/proxy flow.

## Backend Dockerfile Caching
- Copy dependency manifests first.
- Install dependencies before copying full source when possible.
- Then copy source and install the package.
- Keep existing runtime-neutral improvements:
  - PIP_NO_CACHE_DIR, PIP_DISABLE_PIP_VERSION_CHECK
  - curl installation
  - HEALTHCHECK
  - cleaned env configuration

## Healthchecks and Startup Ordering
- MongoDB/Redis healthchecks unchanged.
- Backend healthcheck remains curl /api/v1/health with start period.
- depends_on uses service_healthy to preserve ordering and cold-start stability.

## Verification Checklist

### Expected Active Containers (dev)
- virtai-frontend
- virtai-backend
- virtai-mongodb
- virtai-redis
- virtai-tts

### Expected Exposed Ports (dev)
- 3000 -> frontend (Vite dev server)
- 8000 -> backend (FastAPI)
- 27017 -> MongoDB (127.0.0.1 only)
- 6379 -> Redis (127.0.0.1 only)
- 8080 -> TTS service

### Expected Proxy Behavior
- http://localhost:3000/api/* proxies to http://backend:8000
- No CORS warnings for auth/CSRF flow
- credentials: "include" continues working via same-origin proxy

### Expected Healthcheck Behavior
- MongoDB/Redis become healthy before backend starts.
- Backend becomes healthy after app startup and remains healthy across rebuilds.
