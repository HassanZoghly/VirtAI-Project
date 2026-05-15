# ─────────────────────────────────────────────────────────────
# VirtAI Backend — FastAPI
# Optimized Development Dockerfile
# ─────────────────────────────────────────────────────────────

FROM python:3.10-slim

# ── Environment ─────────────────────────────────────────────
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# ── System dependencies ────────────────────────────────────
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    curl && \
    rm -rf /var/lib/apt/lists/*

# ── Install Python dependencies first (cache optimization) ─
# Copy only the dependency manifest so pip install is cached
# independently of application source changes.
COPY pyproject.toml ./

# Minimal stub so "pip install ." can resolve the package
# without copying the full source tree yet.
RUN mkdir -p app && touch app/__init__.py && \
    pip install --upgrade pip && \
    pip install .

# ── Copy application source (invalidates less often) ───────
COPY app ./app

# ── Runtime directories ────────────────────────────────────
RUN mkdir -p /app/.data/sessions

# ── Expose port ────────────────────────────────────────────
EXPOSE 8000

# ── Healthcheck ────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

# ── Start server ───────────────────────────────────────────
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
