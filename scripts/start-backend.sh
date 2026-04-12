#!/bin/bash
# Start Backend Service
# Usage: ./scripts/start-backend.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SCRIPT_DIR/../backend/websearch_service"

# Prefer service .venv, then repo-root .venv (common monorepo layout).
if [ -d ".venv" ]; then
    VENV_DIR=".venv"
elif [ -d "venv" ]; then
    VENV_DIR="venv"
elif [ -d "$REPO_ROOT/.venv" ]; then
    VENV_DIR="$REPO_ROOT/.venv"
elif [ -d "$REPO_ROOT/venv" ]; then
    VENV_DIR="$REPO_ROOT/venv"
else
    echo "Virtual environment not found. Run setup first:"
    echo "  cd backend/websearch_service && python3 -m venv .venv"
    echo "  source .venv/bin/activate && pip install -r requirements.txt"
    echo "Or create .venv at repo root and re-run this script."
    exit 1
fi

# Activate virtual environment
source "$VENV_DIR/bin/activate"

# Load .env file if it exists (backend will also load it, but this helps with warnings)
if [ -f ".env" ]; then
    echo "Loading environment variables from .env file..."
    set -a
    source .env
    set +a
fi

# Check for OpenAI API key
if [ -z "$OPENAI_API_KEY" ]; then
    echo "OPENAI_API_KEY not set. Please set it:"
    echo "  export OPENAI_API_KEY=sk-your-key-here"
    echo "  Or add it to backend/websearch_service/.env"
    echo ""
    echo "Starting server anyway (will fail on AI requests)..."
fi

# Optional: Check for Perplexity API key (fallback)
if [ -z "$PERPLEXITY_API_KEY" ]; then
    echo "PERPLEXITY_API_KEY not set (optional fallback for OpenAI limits)"
    echo "  To enable fallback: export PERPLEXITY_API_KEY=pplx-your-key-here"
    echo "  Or add it to backend/websearch_service/.env"
fi

# Start server (default 7000 to avoid clashing with other stacks on 8000; override with PORT=)
PORT="${PORT:-7000}"
echo "Starting backend server on http://localhost:${PORT}"
echo "API docs: http://localhost:${PORT}/docs"
echo "Frontend against this API: npm run dev:local  (separate terminal)"
echo "Override: PORT=8000 npm run start:backend"
echo ""
uvicorn app.main:app --reload --host 0.0.0.0 --port "${PORT}"
