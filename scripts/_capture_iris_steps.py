"""Capture STEP 1 npm output (brief), start uvicorn on 7000, STEP 1b openapi, STEP 2 CLI, print server log."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVC = ROOT / "backend" / "websearch_service"
PY = ROOT / ".venv" / "Scripts" / "python.exe"
if not PY.exists():
    PY = Path(sys.executable)
PORT = 7000
HOST = "0.0.0.0"
BASE = f"http://localhost:{PORT}"


def _print(s: str) -> None:
    sys.stdout.write(s)
    if not s.endswith("\n"):
        sys.stdout.write("\n")
    sys.stdout.flush()


def step1_npm_capture() -> str:
    """Run user's npm command; read stdout for ~5s then kill (npm never exits)."""
    lines: list[str] = []

    def _read(p: subprocess.Popen[str]) -> None:
        assert p.stdout
        for line in iter(p.stdout.readline, ""):
            if not line:
                break
            lines.append(line)

    p = subprocess.Popen(
        f"npm run start:backend -- --port {PORT}",
        cwd=str(ROOT),
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    th = threading.Thread(target=_read, args=(p,))
    th.daemon = True
    th.start()
    time.sleep(8)
    try:
        p.kill()
    except Exception:
        pass
    th.join(timeout=2)
    return "".join(lines)


def main() -> None:
    _print("========== STEP 1 - npm run start:backend -- --port 7000 (first ~8s of output, then killed) ==========")
    npm_out = step1_npm_capture()
    _print(npm_out if npm_out else "(no stdout captured in 8s window)\n")
    time.sleep(2)

    _print("========== STEP 1 (alternate) - uvicorn directly on port 7000 (for OpenAPI + CLI) ==========")
    env = os.environ.copy()
    env["PORT"] = str(PORT)
    env.setdefault("AUTH_REQUIRED", "false")

    log_path = Path(tempfile.gettempdir()) / f"iris_uvicorn_step_{os.getpid()}.log"
    log_f = open(log_path, "w", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(
        [
            str(PY),
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(PORT),
        ],
        cwd=str(SVC),
        env=env,
        stdout=log_f,
        stderr=subprocess.STDOUT,
        text=True,
    )
    log_f.close()

    deadline = time.time() + 90
    health_ok = False
    while time.time() < deadline:
        if proc.poll() is not None:
            break
        try:
            urllib.request.urlopen(f"{BASE}/health", timeout=2)
            health_ok = True
            break
        except (urllib.error.URLError, OSError):
            time.sleep(0.4)
    if not health_ok:
        _print("FAILED: /health never became ready (uvicorn exited or still starting).")
        with open(log_path, encoding="utf-8", errors="replace") as f:
            _print("=== server log ===")
            _print(f.read())
        _stop()
        sys.exit(1)

    def _stop() -> None:
        try:
            proc.terminate()
            proc.wait(timeout=15)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    try:
        _print("========== STEP 1b - openapi.json paths containing 'chat' ==========")
        try:
            raw = urllib.request.urlopen(f"{BASE}/openapi.json", timeout=15).read().decode("utf-8")
        except (urllib.error.URLError, OSError) as e:
            _print(f"FAILED to fetch openapi: {e!r}")
            with open(log_path, encoding="utf-8", errors="replace") as f:
                _print("=== server log (startup failure?) ===")
                _print(f.read())
            _stop()
            sys.exit(1)

        data = json.loads(raw)
        chat_paths = [k for k in data.get("paths", {}) if "chat" in k.lower()]
        _print(json.dumps(chat_paths, indent=2))
        if not any("/api/chat" in k for k in chat_paths):
            _print("=== FULL openapi.json (required because /api/chat not found) ===")
            _print(raw)
            _stop()
            sys.exit(1)

        token = os.environ.get("IRIS_TOKEN", "").strip()
        _print("========== STEP 2 - IRIS_TOKEN ==========")
        if not token:
            token = "local-dev-placeholder"
            _print("(IRIS_TOKEN not set; using placeholder for non-interactive run; server has AUTH_REQUIRED=false)")
        else:
            _print(token)

        stdin = "hey\nok\nwhat is inflation?\nanalyse my portfolio risk against the ISEQ\nq\n"
        cli_env = os.environ.copy()
        cli_env["IRIS_TOKEN"] = token

        _print("========== STEP 2 - CLI stdout/stderr ==========")
        cli = subprocess.run(
            [str(PY), str(ROOT / "scripts" / "iris_cli.py"), "--url", BASE],
            input=stdin,
            text=True,
            capture_output=True,
            timeout=600,
            cwd=str(ROOT),
            env=cli_env,
        )
        sys.stdout.write(cli.stdout or "")
        sys.stdout.flush()
        sys.stderr.write(cli.stderr or "")
        sys.stderr.flush()

        time.sleep(1)
        _print("========== STEP 3 - uvicorn log (verbatim file) ==========")
        with open(log_path, encoding="utf-8", errors="replace") as f:
            sys.stdout.write(f.read())
        sys.stdout.flush()
    finally:
        _stop()
        try:
            log_path.unlink()
        except OSError:
            pass


if __name__ == "__main__":
    main()
