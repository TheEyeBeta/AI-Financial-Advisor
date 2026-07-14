# Multi-stage Dockerfile for production-ready Python FastAPI service
# Base image pinned by immutable digest (#206). To update: pick the new tag,
# resolve its digest (docker buildx imagetools inspect python:3.12-slim),
# update BOTH lines, and rebuild.
FROM python:3.14-slim@sha256:d3400aa122fa42cf0af0dbe8ec3091b047eac5c8f7e3539f7135e86d855dc015 AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy the hash-locked runtime dependency set only (#206) — test tooling
# lives in requirements-dev.txt and never enters the production image.
COPY requirements.txt .

# Install Python dependencies. Hashes in requirements.txt make pip verify
# every artifact (hash-checking mode is implied by a hashed lockfile).
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --require-hashes -r requirements.txt

# Production stage
FROM python:3.14-slim@sha256:d3400aa122fa42cf0af0dbe8ec3091b047eac5c8f7e3539f7135e86d855dc015

# ARGs are stage-scoped: redeclare here so the ENV lines below actually
# receive values (#210 — previously these resolved to empty strings).
ARG APP_VERSION=0.1.0
ARG ENVIRONMENT=production

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_VERSION=${APP_VERSION} \
    ENVIRONMENT=${ENVIRONMENT}

# Create non-root user for security
RUN groupadd -r appuser && useradd -r -g appuser appuser && \
    mkdir -p /app/logs && \
    chown -R appuser:appuser /app

# Set working directory
WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
COPY --chown=appuser:appuser . .

# Switch to non-root user
USER appuser

# Expose port (default, Railway overrides with $PORT)
EXPOSE 8000

# Container-level liveness probe (#210). Railway's platform probe hits
# /health/ready (railway.json); this in-container check covers docker/compose
# runs where no platform probe exists. Uses stdlib only — no curl in slim.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/health/live', timeout=4)" || exit 1

# Run uvicorn - shell form for proper $PORT expansion
CMD /bin/sh -c "uvicorn app.main:app --host 0.0.0.0 --port \${PORT:-8000} --workers \${WORKERS:-1} --log-level \${LOG_LEVEL:-info}"
