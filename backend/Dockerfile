# ─────────────────────────────────────────────────────────────
# VirtAI Backend — FastAPI
# Optimized Development Dockerfile
# ─────────────────────────────────────────────────────────────

FROM python:3.10-slim

# ── Environment ─────────────────────────────────────────────
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    XDG_CACHE_HOME=/app/.cache \
    HF_HOME=/app/.cache/huggingface \
    FASTEMBED_CACHE_DIR=/app/.cache/fastembed

WORKDIR /app

ARG EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
ENV EMBEDDING_MODEL=${EMBEDDING_MODEL}

# ── System dependencies ────────────────────────────────────
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    tesseract-ocr \
    tesseract-ocr-eng \
    poppler-utils && \
    rm -rf /var/lib/apt/lists/*

# Verify Tesseract is available for OCR fallback in PDF parsing
RUN tesseract --version

# ── Install Python dependencies first (cache optimization) ─
# Copy only the dependency manifest so pip install is cached
# independently of application source changes.
COPY pyproject.toml ./

# Minimal stub so "pip install ." can resolve the package
# without copying the full source tree yet.
RUN mkdir -p app && touch app/__init__.py && \
    pip install --upgrade pip && \
    pip install .

# Pre-download FastEmbed model into an image layer so production startup does
# not fetch model files dynamically. A named Docker volume can persist this
# cache across container replacements.
RUN mkdir -p /app/.cache/fastembed /app/.cache/huggingface && \
    python -c "import os; from fastembed import TextEmbedding; model=os.environ.get('EMBEDDING_MODEL', 'BAAI/bge-small-en-v1.5'); list(TextEmbedding(model_name=model).embed(['warmup']))"

# ── Copy application source (invalidates less often) ───────
COPY app ./app

# ── Copy Alembic migration scripts & config ────────────────
# Required so `alembic upgrade head` works inside the container.
COPY alembic.ini ./alembic.ini
COPY alembic ./alembic

# ── Runtime directories ────────────────────────────────────
RUN mkdir -p /app/.data/sessions /app/.data/uploads

# ── Expose port ────────────────────────────────────────────
EXPOSE 8000

# ── Healthcheck ────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

# ── Start server ───────────────────────────────────────────
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
