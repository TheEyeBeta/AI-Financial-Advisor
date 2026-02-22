#!/bin/sh
set -e

# Default PORT to 8000 if not set
PORT="${PORT:-8000}"
WORKERS="${WORKERS:-2}"
LOG_LEVEL="${LOG_LEVEL:-info}"

echo "Starting uvicorn on port $PORT with $WORKERS workers..."

exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --workers "$WORKERS" --log-level "$LOG_LEVEL"
