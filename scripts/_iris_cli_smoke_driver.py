"""One-shot: start uvicorn (AUTH_REQUIRED=false), run iris_cli scripted input, print server+CLI output."""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVC = ROOT / "backend" / "websearch_service"
PY = ROOT / ".venv" / "Scripts" / "python.exe"
if not PY.exists():
    PY = Path(sys.executable)
HOST = "127.0.0.1"
PORT = 7000
BASE = f"http://{HOST}:{PORT}"


def main() -> None:
    env = os.environ.copy()
    env["AUTH_REQUIRED"] = "false"

    log_path = str(Path(tempfile.gettempdir()) / f"iris_smoke_{os.getpid()}.log")

    proc = subprocess.Popen(
        [
            str(PY),
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            HOST,
            "--port",
            str(PORT),
            "--log-level",
            "info",
        ],
        cwd=str(SVC),
        env=env,
        stdout=open(log_path, "w", encoding="utf-8"),
        stderr=subprocess.STDOUT,
        text=True,
    )

    def _kill() -> None:
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

    try:
        deadline = time.time() + 120
        while time.time() < deadline:
            if proc.poll() is not None:
                with open(log_path, encoding="utf-8", errors="replace") as f:
                    print("=== Uvicorn exited early ===", file=sys.stderr)
                    print(f.read(), file=sys.stderr)
                sys.exit(1)
            try:
                urllib.request.urlopen(f"{BASE}/health", timeout=2)
                break
            except (urllib.error.URLError, OSError):
                time.sleep(0.5)
        else:
            print("Timeout waiting for /health", file=sys.stderr)
            _kill()
            sys.exit(1)

        stdin = "hey\nok\nwhat is inflation?\nanalyse my portfolio risk against the ISEQ\nq\n"
        cli = subprocess.run(
            [
                str(PY),
                str(ROOT / "scripts" / "iris_cli.py"),
                "--url",
                BASE,
                "--token",
                "dev-bypass",
            ],
            input=stdin,
            text=True,
            capture_output=True,
            timeout=600,
            cwd=str(ROOT),
        )
        time.sleep(1.5)

        print("========== CLI STDOUT ==========")
        print(cli.stdout or "(empty)")
        print("========== CLI STDERR ==========")
        print(cli.stderr or "(empty)")
        print("========== SERVER LOG (tail, classify / tier / classify_query) ==========")
        with open(log_path, encoding="utf-8", errors="replace") as f:
            full = f.read()
        for line in full.splitlines():
            low = line.lower()
            if any(
                k in low
                for k in (
                    "tier",
                    "classify_intent",
                    "classify_tier",
                    "classify_query",
                    "_classify_query",
                    "query classified",
                    "instant",
                )
            ):
                print(line)
    finally:
        _kill()
        try:
            os.unlink(log_path)
        except OSError:
            pass


if __name__ == "__main__":
    main()
