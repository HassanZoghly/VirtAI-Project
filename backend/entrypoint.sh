#!/bin/bash
set -e

# Fix permissions for runtime mounted volumes
mkdir -p /app/.data/sessions /app/.data/uploads /app/.cache

# Chown everything in .data and .cache to appuser
chown -R appuser:appuser /app/.data
chown -R appuser:appuser /app/.cache

# Execute the passed container command via gosu to drop privileges gracefully
exec gosu appuser "$@"
