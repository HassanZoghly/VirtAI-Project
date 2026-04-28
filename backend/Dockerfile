# ── Backend Dockerfile ─────────────────────────────────────────────
# Python 3.10 slim image for FastAPI + Uvicorn
# ───────────────────────────────────────────────────────────────────

FROM python:3.10-slim AS base

# Prevent Python from writing .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# ── Install system dependencies ──────────────────────────────────
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# ── Install Python dependencies ──────────────────────────────────
# Copy only dependency files first to leverage Docker layer caching
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir .

# ── Copy application source code ────────────────────────────────
COPY app/ ./app/

# ── Create data directory for audio files ────────────────────────
RUN mkdir -p /app/.data/sessions

# ── Expose backend port ─────────────────────────────────────────
EXPOSE 8000

# ── Start the server ─────────────────────────────────────────────
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
