#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../backend/websearch_service"

if [ -x ".venv/bin/python" ]; then
  PYTHON_BIN="./.venv/bin/python"
elif [ -x "venv/bin/python" ]; then
  PYTHON_BIN="./venv/bin/python"
else
  echo "Virtual environment not found. Create one with:"
  echo "  python3 -m venv .venv"
  echo "  source .venv/bin/activate"
  echo "  pip install -r requirements.txt"
  exit 1
fi

echo "Starting backend with Railway environment variables on http://127.0.0.1:8000"
echo "This uses the linked Railway project/service from backend/websearch_service."
echo "Local overrides: ENVIRONMENT=development for localhost CORS/trusted-host behavior."
echo ""

npx railway run bash -lc "export ENVIRONMENT=development; \"$PYTHON_BIN\" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
