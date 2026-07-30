# Multi-stage Dockerfile for production-ready Python FastAPI service
# Base image pinned by immutable digest (#206). To update: pick the new tag,
# resolve its digest (docker buildx imagetools inspect python:3.12-slim),
# update BOTH lines, and rebuild.
FROM python:3.12-slim@sha256:423ed6ab25b1921a477529254bfeeabf5855151dc2c3141699a1bfc852199fbf AS builder

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
#
# pip itself is pinned to an exact version (not a floating --upgrade) so a
# Docker layer-cache hit can never silently keep shipping an old, CVE-bearing
# pip into the image — that's exactly what happened here: pip-audit run
# against a built image found 6 known CVEs (PYSEC-2026-196/1795/1796/2875/2876)
# in a cached pip==25.0.1 layer even though this RUN said "--upgrade pip".
# Bump this pin when pip-audit reports a newer fixed version.
RUN pip install --no-cache-dir pip==26.1.2 && \
    pip install --no-cache-dir --require-hashes -r requirements.txt

# Production stage
FROM python:3.12-slim@sha256:423ed6ab25b1921a477529254bfeeabf5855151dc2c3141699a1bfc852199fbf

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

# Run uvicorn via `exec` so it replaces the shell as PID 1 and receives
# SIGTERM directly (plain shell-form CMD leaves /bin/sh as PID 1, which
# does not forward signals, so the container hangs until SIGKILL on stop).
# JSON-array form here also satisfies buildkit's JSONArgsRecommended check.
CMD ["/bin/sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WORKERS:-1} --log-level ${LOG_LEVEL:-info}"]
