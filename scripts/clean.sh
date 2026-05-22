#!/usr/bin/env bash

echo "Cleaning Python cache files and directories..."

find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null

find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null
find . -type f -name "*.pyc" -delete 2>/dev/null

echo "Done."
