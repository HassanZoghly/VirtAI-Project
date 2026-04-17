#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  VirtAI — Start Docker Environment (Production Override)
# ═══════════════════════════════════════════════════════════════════
set -e

cd "$(dirname "$0")/.."

echo "╔══════════════════════════════════════════════════╗"
echo "║     VirtAI — Docker Start Script (PROD)          ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

echo "✅ Docker is installed."

if ! docker info &> /dev/null; then
    echo "⚠️  Docker is not running. Attempting to start Docker..."

    if [[ "$OSTYPE" == "darwin"* ]]; then
        open -a "Docker" 2>/dev/null || true
    elif command -v systemctl &> /dev/null; then
        sudo systemctl start docker 2>/dev/null || true
    fi

    echo "   Waiting for Docker to start..."
    TIMEOUT=60
    ELAPSED=0
    while ! docker info &> /dev/null; do
        sleep 2
        ELAPSED=$((ELAPSED + 2))
        if [ $ELAPSED -ge $TIMEOUT ]; then
            echo ""
            echo "❌ Docker did not start within ${TIMEOUT} seconds."
            echo "   Please start Docker manually and try again."
            exit 1
        fi
        printf "   ⏳ Waiting... (%ds/%ds)\r" "$ELAPSED" "$TIMEOUT"
    done
    echo ""
    echo "✅ Docker is now running."
else
    echo "✅ Docker is already running."
fi

echo ""
echo "🚀 Starting VirtAI in PRODUCTION mode..."
echo ""

docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

echo ""
echo "✅ VirtAI production environment is up."
echo "- Website : http://localhost:3000"
echo ""
echo "To view logs:"
echo "   docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f"
