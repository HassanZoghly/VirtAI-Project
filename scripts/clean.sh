#!/usr/bin/env bash

# ============================================
# Go to project root (parent of scripts/)
# ============================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "============================================"
echo " Cleaning ALL Python cache/temp files..."
echo " Project Root: $(pwd)"
echo "============================================"

# --------------------------------------------
# Delete cache directories
# --------------------------------------------
find . -type d -name "__pycache__"        -exec rm -rf {} + 2>/dev/null
find . -type d -name ".pytest_cache"     -exec rm -rf {} + 2>/dev/null
find . -type d -name ".mypy_cache"       -exec rm -rf {} + 2>/dev/null
find . -type d -name ".ruff_cache"       -exec rm -rf {} + 2>/dev/null
find . -type d -name ".ipynb_checkpoints" -exec rm -rf {} + 2>/dev/null
find . -type d -name ".tox"              -exec rm -rf {} + 2>/dev/null
find . -type d -name ".nox"              -exec rm -rf {} + 2>/dev/null
find . -type d -name "build"             -exec rm -rf {} + 2>/dev/null
find . -type d -name "dist"              -exec rm -rf {} + 2>/dev/null
find . -type d -name "*.egg-info"        -exec rm -rf {} + 2>/dev/null

# --------------------------------------------
# Delete compiled/temp files
# --------------------------------------------
find . -type f -name "*.pyc" -delete 2>/dev/null
find . -type f -name "*.pyo" -delete 2>/dev/null
find . -type f -name "*.pyd" -delete 2>/dev/null

# --------------------------------------------
# Delete logs/temp files
# --------------------------------------------
find . -type f -name "*.log" -delete 2>/dev/null
find . -type f -name "*.tmp" -delete 2>/dev/null

# --------------------------------------------
# Delete coverage files
# --------------------------------------------
find . -type f -name ".coverage"   -delete 2>/dev/null
find . -type f -name "coverage.xml" -delete 2>/dev/null

echo "============================================"
echo " DONE CLEANING"
echo "============================================"
