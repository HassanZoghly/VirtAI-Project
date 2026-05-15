#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  VirtAI — Start Docker Environment (Production)
# ═══════════════════════════════════════════════════════════════════
set -e

# Move to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/docker-compose.yml" ]]; then
    PROJECT_ROOT="$SCRIPT_DIR"
else
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$PROJECT_ROOT"

echo "╔══════════════════════════════════════════════════╗"
echo "║     VirtAI — Docker Start Script (PROD)          ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# 1. Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed."
    echo "   Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi
echo "✅ Docker is installed."

# 2. Check if Docker is running
if ! docker info &> /dev/null; then
    echo "❌ Docker is not running."
    echo ""
    echo "   Please start Docker manually:"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "     - Open Docker Desktop from Applications folder"
    elif [[ -f /var/run/docker.sock ]]; then
        echo "     - Run: sudo systemctl start docker  (Linux with systemd)"
        echo "     - Or:  sudo service docker start"
    else
        echo "     - Start Docker using your system's service manager"
    fi
    echo ""
    echo "   After starting Docker, re-run this script."
    exit 1
fi
echo "✅ Docker is running."

# 3. Verify required files exist
if [[ ! -f "docker-compose.yml" ]]; then
    echo "❌ Missing required file: docker-compose.yml"
    exit 1
fi
if [[ ! -f "docker-compose.prod.yml" ]]; then
    echo "❌ Missing required file: docker-compose.prod.yml"
    exit 1
fi
echo "✅ Docker compose files found."

# 4. Parse flags
REBUILD=""
PULL=""
for arg in "$@"; do
    case $arg in
        --no-build)
            REBUILD=""
            echo "ℹ️  Skipping build (--no-build)."
            ;;
        --pull)
            PULL="--pull always"
            echo "ℹ️  Will pull latest base images."
            ;;
    esac
done

if [[ -z "$REBUILD" ]] && [[ "$1" != "--no-build" ]]; then
    REBUILD="--build"
    echo "ℹ️  Will rebuild images before starting (default)."
fi

# 5. Check if production containers are already running (BEFORE starting)
if docker compose -f docker-compose.yml -f docker-compose.prod.yml ps | grep -q "Up"; then
    echo ""
    echo "⚠️  Production containers are already running."
    read -p "Do you want to restart them? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Exiting without changes."
        exit 0
    fi
    echo "🔄 Stopping existing containers..."
    docker compose -f docker-compose.yml -f docker-compose.prod.yml down
    echo ""
fi

echo ""
echo "🚀 Starting VirtAI in PRODUCTION mode..."
echo ""

# 6. Run production environment
docker compose -f docker-compose.yml -f docker-compose.prod.yml up $REBUILD $PULL -d

echo ""
echo "✅ VirtAI production environment is up."
echo "- Website : http://localhost:3000"
echo ""
echo "Useful commands:"
echo "  View logs:      docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f"
echo "  Stop services:  docker compose -f docker-compose.yml -f docker-compose.prod.yml down"
echo "  Restart:        docker compose -f docker-compose.yml -f docker-compose.prod.yml restart"
echo ""
if [[ -n "$REBUILD" ]]; then
    echo "To skip rebuilding next time: ./$(basename "$0") --no-build"
fi
if [[ -z "$PULL" ]]; then
    echo "To pull latest images:   ./$(basename "$0") --pull"
fi
