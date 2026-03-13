#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  VirtAI — Start Docker Environment
# ═══════════════════════════════════════════════════════════════════
set -e

# Navigate to project root (parent of scripts/)
cd "$(dirname "$0")/.."

echo "╔═══════════════════════════════════════════════╗"
echo "║        VirtAI — Docker Start Script           ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

# ── Step 1: Check if Docker is installed ─────────────────────────
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Download: https://www.docker.com/products/docker-desktop"
    exit 1
fi

echo "✅ Docker is installed."

# ── Step 2: Check if Docker daemon is running ────────────────────
if ! docker info &> /dev/null; then
    echo "⚠️  Docker is not running. Attempting to start Docker Desktop..."

    # Try to start Docker Desktop on macOS
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open -a "Docker" 2>/dev/null || true
    # Try to start Docker on Linux (systemd)
    elif command -v systemctl &> /dev/null; then
        sudo systemctl start docker 2>/dev/null || true
    fi

    # Wait for Docker to become available (up to 60 seconds)
    echo "   Waiting for Docker to start..."
    TIMEOUT=60
    ELAPSED=0
    while ! docker info &> /dev/null; do
        sleep 2
        ELAPSED=$((ELAPSED + 2))
        if [ $ELAPSED -ge $TIMEOUT ]; then
            echo "❌ Docker did not start within ${TIMEOUT} seconds."
            echo "   Please start Docker Desktop manually and try again."
            exit 1
        fi
        printf "   ⏳ Waiting... (%ds/%ds)\r" "$ELAPSED" "$TIMEOUT"
    done
    echo ""
    echo "✅ Docker is now running."
else
    echo "✅ Docker is already running."
fi

# ── Step 3: Start the project ───────────────────────────────────
echo ""
echo "🚀 Starting VirtAI..."
echo ""

docker compose up --build
