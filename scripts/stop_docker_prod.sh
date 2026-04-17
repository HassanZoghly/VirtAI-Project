#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  VirtAI — Stop Docker Environment (Production)
# ═══════════════════════════════════════════════════════════════════
set -e

cd "$(dirname "$0")/.."

echo "🛑 Stopping VirtAI production environment..."

docker compose -f docker-compose.yml -f docker-compose.prod.yml down

echo "✅ VirtAI stopped."
