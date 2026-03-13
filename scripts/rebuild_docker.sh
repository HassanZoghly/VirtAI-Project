#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  VirtAI — Rebuild Docker Environment
# ═══════════════════════════════════════════════════════════════════
set -e

# Navigate to project root (parent of scripts/)
cd "$(dirname "$0")/.."

echo "╔═══════════════════════════════════════════════╗"
echo "║       VirtAI — Docker Rebuild Script          ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

echo "🛑 Stopping existing containers..."
docker compose down

echo ""
echo "🔨 Rebuilding images from scratch (no cache)..."
docker compose build --no-cache

echo ""
echo "🚀 Starting VirtAI with fresh images..."
docker compose up
