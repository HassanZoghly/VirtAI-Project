#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  VirtAI — Stop Docker Environment
# ═══════════════════════════════════════════════════════════════════
set -e

# Navigate to project root (parent of scripts/)
cd "$(dirname "$0")/.."

echo "╔═══════════════════════════════════════════════╗"
echo "║        VirtAI — Docker Stop Script            ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

# ── Check if any project containers are running ──────────────────
RUNNING=$(docker compose ps -q 2>/dev/null)

if [ -z "$RUNNING" ]; then
    echo "ℹ️  The Docker project is already stopped."
else
    echo "🛑 Stopping VirtAI containers..."
    docker compose down
    echo ""
    echo "✅ VirtAI has been stopped."
fi
