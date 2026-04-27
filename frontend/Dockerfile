# ── Frontend Dockerfile ────────────────────────────────────────────
# Node 20 Alpine for React + Vite dev server
# ───────────────────────────────────────────────────────────────────

FROM node:22-alpine

WORKDIR /app

# ── Install dependencies ─────────────────────────────────────────
# Copy dependency files first for Docker layer caching
COPY package*.json ./
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-timeout 300000 && \
    npm config set maxsockets 3 && \
    npm config set prefer-offline true && \
    npm install --no-audit --no-fund --legacy-peer-deps

# ── Copy application source code ────────────────────────────────
COPY . .

# ── Expose frontend port ────────────────────────────────────────
EXPOSE 3000

# ── Start Vite dev server ────────────────────────────────────────
# --host 0.0.0.0 makes the server accessible outside the container
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "3000"]
