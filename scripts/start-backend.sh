#!/bin/bash
# Start Backend Service
# Usage: ./scripts/start-backend.sh

cd "$(dirname "$0")/../backend/websearch_service"

# Prefer .venv but support the older venv name as a fallback.
if [ -d ".venv" ]; then
    VENV_DIR=".venv"
elif [ -d "venv" ]; then
    VENV_DIR="venv"
else
    echo "Virtual environment not found. Run setup first:"
    echo "  python3 -m venv .venv"
    echo "  source .venv/bin/activate"
    echo "  pip install -r requirements.txt"
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

# Start server
echo "Starting backend server on http://localhost:8000"
echo "API docs: http://localhost:8000/docs"
echo ""
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
