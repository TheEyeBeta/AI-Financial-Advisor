#!/usr/bin/env python3
"""
IRIS chat CLI — streams POST /api/chat against a local (or remote) FastAPI backend.

Auth: Bearer JWT (Supabase user access_token). Interactive login uses Supabase
Auth REST (no login route exists in app/services/auth.py).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from getpass import getpass
from pathlib import Path
from typing import Any, Optional

# ── Phase 1: resolve backend package for TRIVIAL_PATTERNS (same as classify_tier) ─
_REPO_ROOT = Path(__file__).resolve().parent.parent
_SERVICE_ROOT = _REPO_ROOT / "backend" / "websearch_service"
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))

try:
    import httpx
except ImportError:
    print("pip install httpx", file=sys.stderr)
    sys.exit(1)

try:
    from app.services.subagents import TRIVIAL_PATTERNS
except ImportError as exc:
    print(
        "Could not import TRIVIAL_PATTERNS from app.services.subagents.\n"
        f"Expected backend at: {_SERVICE_ROOT}\n"
        f"ImportError: {exc}",
        file=sys.stderr,
    )
    sys.exit(1)

# Reference timeouts (ms) from frontend getTimeoutForMessage — informational only
_TIMEOUT_REFERENCE_MS = (15_000, 25_000, 45_000, 90_000)

# Chat defaults aligned with src/services/api.ts (OPENAI_CHAT_TEMPERATURE, OPENAI_MAX_TOKENS)
_DEFAULT_TEMPERATURE = 0.7
_DEFAULT_MAX_TOKENS = 2000


def _dim(s: str) -> str:
    if not sys.stdout.isatty():
        return s
    return f"\033[2m{s}\033[0m"


def _red(s: str) -> str:
    if not sys.stdout.isatty():
        return s
    return f"\033[31m{s}\033[0m"


def _safe_write(stream: Any, text: str) -> None:
    try:
        stream.write(text)
    except UnicodeEncodeError:
        encoding = getattr(stream, "encoding", None) or "utf-8"
        if hasattr(stream, "buffer"):
            stream.buffer.write(text.encode(encoding, errors="replace"))
        else:
            stream.write(text.encode(encoding, errors="replace").decode(encoding, errors="replace"))


def _safe_flush(stream: Any) -> None:
    try:
        stream.flush()
    except UnicodeEncodeError:
        pass


def _jwt_sub_unverified(token: str) -> Optional[str]:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        payload_b64 = parts[1]
        pad = "=" * (-len(payload_b64) % 4)
        raw = base64.urlsafe_b64decode(payload_b64 + pad)
        data = json.loads(raw.decode("utf-8"))
        sub = data.get("sub")
        return str(sub) if sub else None
    except Exception:
        return None


def _supabase_env() -> tuple[str, str]:
    url = (os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL") or "").strip()
    anon = (os.getenv("SUPABASE_ANON_KEY") or os.getenv("VITE_SUPABASE_ANON_KEY") or "").strip()
    return url, anon


def login_supabase(email: str, password: str) -> str:
    supabase_url, anon_key = _supabase_env()
    if not supabase_url or not anon_key:
        print(
            _red(
                "Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_ANON_KEY "
                "(or VITE_SUPABASE_ANON_KEY) for password login, or pass --token / IRIS_TOKEN."
            ),
            file=sys.stderr,
        )
        sys.exit(1)

    token_url = f"{supabase_url.rstrip('/')}/auth/v1/token?grant_type=password"
    headers = {
        "apikey": anon_key,
        "Authorization": f"Bearer {anon_key}",
        "Content-Type": "application/json",
    }
    try:
        r = httpx.post(
            token_url,
            headers=headers,
            json={"email": email, "password": password},
            timeout=30.0,
        )
    except httpx.ConnectError as exc:
        print(_red(f"[CONNECT ERROR] Could not reach Supabase at {supabase_url}: {exc}"), file=sys.stderr)
        sys.exit(1)

    body_text = r.text
    if r.status_code != 200:
        print(f"Login failed: HTTP {r.status_code}", file=sys.stderr)
        print(body_text, file=sys.stderr)
        sys.exit(1)

    try:
        data = r.json()
    except json.JSONDecodeError:
        print(_red("Login returned non-JSON body:"), file=sys.stderr)
        print(body_text, file=sys.stderr)
        sys.exit(1)

    token = data.get("access_token")
    if not token or not isinstance(token, str):
        print(_red("Login succeeded but `access_token` is missing. Full body:"), file=sys.stderr)
        print(json.dumps(data, indent=2), file=sys.stderr)
        sys.exit(1)

    return token


def _is_trivial_message(text: str) -> bool:
    stripped = text.strip()
    if len(stripped) >= 60:
        return False
    m = TRIVIAL_PATTERNS.fullmatch(stripped)
    return m is not None


def _build_chat_body(
    messages: list[dict[str, str]],
    user_id: Optional[str],
) -> dict[str, Any]:
    # Exact field names from ChatRequest in ai_proxy.py + body shape from api.ts getChatResponse
    body: dict[str, Any] = {
        "messages": messages,
        "temperature": _DEFAULT_TEMPERATURE,
        "max_tokens": _DEFAULT_MAX_TOKENS,
        "experience_level": "beginner",
        "session_type": "advisor",
    }
    if user_id:
        body["user_id"] = user_id
    return body


def _parse_sse_events(buffer: str) -> tuple[list[dict[str, Any]], str]:
    """Split buffer on blank line (SSE event boundary); return (events, remainder)."""
    events: list[dict[str, Any]] = []
    while True:
        sep = buffer.find("\n\n")
        if sep == -1:
            break
        raw_block = buffer[:sep].strip()
        buffer = buffer[sep + 2 :]
        if not raw_block:
            continue
        data_lines = [
            ln[5:].lstrip()
            for ln in raw_block.split("\n")
            if ln.startswith("data:")
        ]
        if not data_lines:
            continue
        joined = "\n".join(data_lines)
        try:
            events.append(json.loads(joined))
        except json.JSONDecodeError:
            continue
    return events, buffer


def send_chat_message(
    base_url: str,
    token: str,
    messages: list[dict[str, str]],
) -> tuple[str, Optional[float], float, Optional[str]]:
    """
    POST /api/chat with SSE. Returns (full_text, ttft_ms, total_ms, error_message).
    ttft_ms is None if no non-empty content delta arrived.
    """
    url = f"{base_url.rstrip('/')}/api/chat"
    user_id = _jwt_sub_unverified(token)
    body = _build_chat_body(messages, user_id)

    headers = {
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    timeout = httpx.Timeout(connect=30.0, read=90.0, write=30.0, pool=30.0)
    ttft_ms: Optional[float] = None
    full_chunks: list[str] = []
    stream_error: Optional[str] = None

    try:
        with httpx.Client(timeout=timeout) as client:
            t_start = time.perf_counter()
            with client.stream("POST", url, headers=headers, json=body) as response:
                if response.status_code == 401:
                    return "", None, (time.perf_counter() - t_start) * 1000, "__HTTP_401__"
                if response.status_code >= 400:
                    try:
                        err_body = response.read().decode("utf-8", errors="replace")
                    except Exception:
                        err_body = ""
                    detail = err_body
                    return (
                        "",
                        None,
                        (time.perf_counter() - t_start) * 1000,
                        f"HTTP {response.status_code}: {detail}",
                    )

                _safe_write(sys.stdout, "IRIS: ")
                _safe_flush(sys.stdout)
                wrote_iris_prefix = True

                buf = ""
                stop = False
                for chunk in response.iter_text():
                    buf += chunk.replace("\r\n", "\n").replace("\r", "\n")
                    parsed, buf = _parse_sse_events(buf)
                    for event in parsed:
                        if event.get("error"):
                            stream_error = str(event["error"])
                            _safe_write(sys.stdout, _red(f"\n[stream error] {stream_error}\n"))
                            _safe_flush(sys.stdout)
                            stop = True
                            break

                        if event.get("done") is True:
                            stop = True
                            break

                        # Optional status-style payloads (backend emits content / done / error only today)
                        if event.get("status") and not event.get("content"):
                            _safe_write(sys.stdout, _dim(f"\n[{event.get('status')}]\nIRIS: "))
                            _safe_flush(sys.stdout)
                            continue

                        content = event.get("content")
                        if isinstance(content, str) and len(content) > 0:
                            if ttft_ms is None:
                                ttft_ms = (time.perf_counter() - t_start) * 1000
                            full_chunks.append(content)
                            _safe_write(sys.stdout, content)
                            _safe_flush(sys.stdout)

                    if stop:
                        break

                if buf.strip():
                    parsed, _ = _parse_sse_events(buf + "\n\n")
                    for event in parsed:
                        if event.get("error"):
                            stream_error = str(event["error"])
                            _safe_write(sys.stdout, _red(f"\n[stream error] {stream_error}\n"))
                            _safe_flush(sys.stdout)
                            break
                        if event.get("done") is True:
                            break
                        if event.get("status") and not event.get("content"):
                            _safe_write(sys.stdout, _dim(f"\n[{event.get('status')}]\nIRIS: "))
                            _safe_flush(sys.stdout)
                            continue
                        content = event.get("content")
                        if isinstance(content, str) and len(content) > 0:
                            if ttft_ms is None:
                                ttft_ms = (time.perf_counter() - t_start) * 1000
                            full_chunks.append(content)
                            _safe_write(sys.stdout, content)
                            _safe_flush(sys.stdout)

                if wrote_iris_prefix:
                    _safe_write(sys.stdout, "\n")
                    _safe_flush(sys.stdout)

    except httpx.ReadTimeout:
        return (
            "".join(full_chunks),
            ttft_ms,
            (time.perf_counter() - t_start) * 1000,
            "__READ_TIMEOUT__",
        )

    total_ms = (time.perf_counter() - t_start) * 1000
    text = "".join(full_chunks)
    if stream_error:
        return text, ttft_ms, total_ms, stream_error
    return text, ttft_ms, total_ms, None


def _print_verdict(last_user_message: str, ttft_ms: Optional[float]) -> None:
    trivial = _is_trivial_message(last_user_message)
    if trivial:
        if ttft_ms is None:
            print(_red("[FAIL] Likely timeout — run PROMPT 2"))
            return
        if ttft_ms < 1000:
            print("[PASS] INSTANT tier responded on time")
        elif ttft_ms < 4000:
            print(_red("[SLOW] Check Railway logs for _classify_query"))
        else:
            print(_red("[FAIL] Likely timeout — run PROMPT 2"))
    else:
        if ttft_ms is None:
            print(_red("[SLOW] no token deltas received"))
            return
        if ttft_ms < 3000:
            print("[PASS]")
        else:
            print(_red(f"[SLOW] {ttft_ms:.0f}ms TTFT"))


def main() -> None:
    p = argparse.ArgumentParser(
        description="Interactive IRIS chat against FastAPI /api/chat (SSE).",
    )
    p.add_argument(
        "--url",
        default=os.getenv("IRIS_BASE_URL", "http://localhost:7000"),
        help="FastAPI base URL (default: http://localhost:7000 or IRIS_BASE_URL).",
    )
    p.add_argument(
        "--token",
        default=os.getenv("IRIS_TOKEN", ""),
        help="Supabase JWT (access_token). Env fallback: IRIS_TOKEN.",
    )
    args = p.parse_args()
    base_url: str = args.url
    token: str = (args.token or "").strip()

    if not token:
        email = input("Email: ").strip()
        if not email:
            print("Email required.", file=sys.stderr)
            sys.exit(1)
        password = getpass("Password: ")
        if not password:
            print("Password required.", file=sys.stderr)
            sys.exit(1)
        token = login_supabase(email, password)

    print(f"IRIS CLI - {base_url} (reference timeouts ms: {_TIMEOUT_REFERENCE_MS})")
    print('Type a message, "clear" to reset history, "quit"/"exit"/"q" to leave.\n')

    history: list[dict[str, str]] = []

    try:
        while True:
            try:
                line = input("You: ")
            except EOFError:
                print("\nBye.")
                break
            except KeyboardInterrupt:
                print("\nBye.")
                break

            text = line.strip()
            if not text:
                continue
            low = text.lower()
            if low in ("quit", "exit", "q"):
                print("Bye.")
                break
            if low == "clear":
                history = []
                print("History cleared.")
                continue

            messages = [*history, {"role": "user", "content": text}]

            try:
                content, ttft_ms, total_ms, err = send_chat_message(base_url, token, messages)
            except httpx.ConnectError:
                print(
                    _red(f"[CONNECT ERROR] Is the backend running at {base_url}?"),
                    file=sys.stderr,
                )
                sys.exit(1)
            except KeyboardInterrupt:
                print("\nBye.")
                break

            if err == "__READ_TIMEOUT__":
                print(_red("[TIMEOUT] No response within 90s."))
                continue

            if err == "__HTTP_401__":
                print(
                    _red("[AUTH ERROR] Token rejected. Re-run with a fresh token."),
                    file=sys.stderr,
                )
                sys.exit(1)

            if err:
                print(_red(err))
                continue

            n_chars = len(content)
            ttft_disp = f"{ttft_ms:.0f}" if ttft_ms is not None else "n/a"
            print(f"TTFT: {ttft_disp}ms | Total: {total_ms:.0f}ms | Chars: {n_chars}")
            _print_verdict(text, ttft_ms)

            history.append({"role": "user", "content": text})
            history.append({"role": "assistant", "content": content})

    except KeyboardInterrupt:
        print("\nBye.")


if __name__ == "__main__":
    main()
