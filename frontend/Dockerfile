# ── Frontend Dockerfile ────────────────────────────────────────────
# Node 20 Alpine for React + Vite dev server
# ───────────────────────────────────────────────────────────────────

FROM node:20-alpine

WORKDIR /app

# ── Install dependencies ─────────────────────────────────────────
# Copy dependency files first for Docker layer caching
COPY package.json package-lock.json ./
RUN npm ci

# ── Copy application source code ────────────────────────────────
COPY . .

# ── Expose frontend port ────────────────────────────────────────
EXPOSE 3000

# ── Start Vite dev server ────────────────────────────────────────
# --host 0.0.0.0 makes the server accessible outside the container
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "3000"]
