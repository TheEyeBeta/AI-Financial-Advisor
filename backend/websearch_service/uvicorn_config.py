"""
Production Uvicorn configuration for FastAPI application.
Use this with: uvicorn app.main:app --config uvicorn_config:config
"""
import multiprocessing
import os

# Server socket
bind = f"0.0.0.0:{os.getenv('PORT', '8000')}"
backlog = 2048

# Worker processes
workers = int(os.getenv("WORKERS", multiprocessing.cpu_count() * 2 + 1))
worker_class = "uvicorn.workers.UvicornWorker"
worker_connections = 1000
# Worker timeout must exceed STREAM_TIMEOUT_SECONDS (90s) in app/routes/ai_proxy.py
# plus headroom; otherwise the worker kills active SSE chat streams before the
# OpenAI client timeout fires. 120s keeps long BALANCED responses intact.
timeout = int(os.getenv("UVICORN_TIMEOUT", "120"))
keepalive = 2

# Logging
accesslog = "-"  # stdout
errorlog = "-"  # stderr
loglevel = os.getenv("LOG_LEVEL", "info").lower()
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)s'

# Process naming
proc_name = "ai-financial-advisor-backend"

# Server mechanics
daemon = False
pidfile = None
umask = 0
user = None
group = None
tmp_upload_dir = None

# SSL (configure if using HTTPS termination)
keyfile = None
certfile = None

# Performance tuning
max_requests = 1000
max_requests_jitter = 50
preload_app = True

# Graceful timeout — match worker timeout so in-flight SSE streams can drain
# during a rolling deploy instead of being severed mid-response.
graceful_timeout = int(os.getenv("UVICORN_GRACEFUL_TIMEOUT", "120"))
