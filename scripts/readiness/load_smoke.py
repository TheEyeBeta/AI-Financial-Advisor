"""Batch 3 Phase 6 — LOCAL in-process load smoke against the real ASGI app.

NOT staging: this drives the real FastAPI app (full middleware stack: correlation
IDs, security headers, CORS) in-process via httpx ASGITransport, under real
asyncio concurrency, to get throughput / latency-percentile / error-rate evidence
with explicit pass/fail thresholds. Staging soak/spike/stress remain external.
"""
import asyncio, os, pathlib, statistics, time, json, logging, tempfile
from unittest.mock import patch, MagicMock

# Diagnosis from the first run: per-request INFO logging (httpx + app.request)
# dominated p95. Silence it so the measurement reflects app request-handling,
# not the driver's log I/O.
logging.disable(logging.INFO)
for _n in ("httpx", "app.request", "uvicorn", "uvicorn.access"):
    logging.getLogger(_n).setLevel(logging.WARNING)

os.environ.update({
    "SUPABASE_URL": "https://local.supabase.co", "SUPABASE_ANON_KEY": "x",
    "SUPABASE_SERVICE_ROLE_KEY": "x", "SUPABASE_JWT_SECRET": "x",
    "OPENAI_API_KEY": "x", "ENVIRONMENT": "test", "AUTH_REQUIRED": "false",
    "APP_VERSION": "batch3-loadsmoke",
})
import sys
REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend" / "websearch_service"))

import httpx
with patch("supabase.create_client", return_value=MagicMock()):
    from app.main import create_app
app = create_app()

# Profiles: (name, endpoint, total_requests, concurrency, p95_ms_threshold, err_threshold)
PROFILES = [
    ("smoke",  "/health/live", 200,  10, 50.0, 0.0),
    ("normal", "/health/live", 1000, 25, 75.0, 0.0),
    ("busy",   "/health/live", 2000, 50, 120.0, 0.01),
]

async def run_profile(name, path, total, concurrency, p95_thr, err_thr):
    transport = httpx.ASGITransport(app=app)
    latencies, errors = [], 0
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(transport=transport, base_url="http://app") as client:
        # Warm-up: discard cold-start requests (standard load-test methodology).
        await asyncio.gather(*(client.get(path) for _ in range(min(30, total))))

        async def one():
            nonlocal errors
            async with sem:
                t0 = time.perf_counter()
                try:
                    r = await client.get(path)
                    if r.status_code != 200:
                        errors += 1
                except Exception:
                    errors += 1
                latencies.append((time.perf_counter() - t0) * 1000.0)
        wall0 = time.perf_counter()
        await asyncio.gather(*(one() for _ in range(total)))
        wall = time.perf_counter() - wall0
    latencies.sort()
    def pct(p): return latencies[min(len(latencies)-1, int(len(latencies)*p))]
    err_rate = errors / total
    p50, p95, p99 = pct(0.50), pct(0.95), pct(0.99)
    rps = total / wall
    passed = (err_rate <= err_thr) and (p95 <= p95_thr)
    return {
        "profile": name, "endpoint": path, "requests": total, "concurrency": concurrency,
        "rps": round(rps, 1), "error_rate": round(err_rate, 4),
        "p50_ms": round(p50, 2), "p95_ms": round(p95, 2), "p99_ms": round(p99, 2),
        "p95_threshold_ms": p95_thr, "err_threshold": err_thr,
        "result": "PASS" if passed else "FAIL",
    }

async def main():
    results = []
    for prof in PROFILES:
        res = await run_profile(*prof)
        results.append(res)
        print(f"[{res['result']}] {res['profile']:<7} n={res['requests']:<4} c={res['concurrency']:<3} "
              f"rps={res['rps']:<7} err={res['error_rate']:<6} "
              f"p50={res['p50_ms']}ms p95={res['p95_ms']}ms p99={res['p99_ms']}ms "
              f"(p95_thr={res['p95_threshold_ms']}ms)")
    result_fd, result_name = tempfile.mkstemp(prefix="load_smoke_result_", suffix=".json")
    with os.fdopen(result_fd, "w") as f:
        f.write(json.dumps(results, indent=2))
    overall = all(r["result"] == "PASS" for r in results)
    print(f"    result: {result_name}")
    print("OVERALL:", "PASS" if overall else "FAIL")
    return 0 if overall else 1

raise SystemExit(asyncio.run(main()))
