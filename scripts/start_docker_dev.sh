#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  VirtAI — Start Docker Environment (Development) - Improved
# ═══════════════════════════════════════════════════════════════════
set -e

# Move to project root (handles script in scripts/ or root directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/docker-compose.yml" ]]; then
    PROJECT_ROOT="$SCRIPT_DIR"
else
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
cd "$PROJECT_ROOT"

echo "╔══════════════════════════════════════════════════╗"
echo "║     VirtAI — Docker Start Script (DEV)           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# 1. Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed."
    echo "   Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi
echo "✅ Docker is installed."

# 2. Check if Docker is running (NO automatic start attempts)
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

# 3. Verify required docker-compose files exist
if [[ ! -f "docker-compose.yml" ]]; then
    echo "❌ Missing required file: docker-compose.yml"
    exit 1
fi
if [[ ! -f "docker-compose.dev.yml" ]]; then
    echo "❌ Missing required file: docker-compose.dev.yml"
    exit 1
fi
echo "✅ Docker compose files found."

# 4. Check for .env file (optional but recommended)
if [[ ! -f ".env" ]]; then
    echo "⚠️  Warning: .env file not found. Copy .env.example to .env and fill required variables."
fi

# 5. Handle flags
REBUILD=""
FORCE_RECREATE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-build)
            REBUILD=""
            ;;
        --force-recreate)
            FORCE_RECREATE="--force-recreate"
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--no-build] [--force-recreate]"
            exit 1
            ;;
    esac
    shift
done

if [[ -z "$REBUILD" ]]; then
    echo "ℹ️  Skipping build (using --no-build)."
else
    REBUILD="--build"
fi

echo ""
echo "🚀 Starting VirtAI in DEVELOPMENT mode..."
echo ""

# 6. Run using docker compose (modern syntax)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up $REBUILD $FORCE_RECREATE -d

echo ""
echo "✅ VirtAI development environment is up."
echo "- Website : http://localhost:3000"
echo ""
echo "To view logs:"
echo "   docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f"
echo ""
if [[ -z "$REBUILD" ]]; then
    echo "To rebuild images next time, run without --no-build"
else
    echo "To force rebuild images, remove --no-build flag"
fi
