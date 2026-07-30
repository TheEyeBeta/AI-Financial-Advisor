# Evidence — Dependency vulnerability audit (pip-audit + npm audit)

**Date:** 2026-07-22
**Method:** `pip-audit` run inside the actual built Linux backend Docker image
(not a Windows host resolve, which cannot build this backend's Linux-only
lockfile — `uvloop` has no Windows wheel); `npm audit` run against a
Linux-regenerated `package-lock.json` (see §3).

## 1. Backend — pip-audit

Ran `pip-audit` (no `-r`, audits the actually-installed environment) inside
`ai-financial-advisor-backend:test`, built from `backend/websearch_service/Dockerfile`
via `docker build --no-cache`.

**Before fix:** `pip-audit`'s own summary line reported "Found 6 known
vulnerabilities in 1 package" — `pip==25.0.1` (system pip, resolved because
the Dockerfile's `RUN pip install --upgrade pip` hit a stale BuildKit cache
layer instead of re-resolving against PyPI). Its JSON vuln list contained 6
entries but only 5 *distinct* advisories — `pip-audit` listed
`PYSEC-2026-196` (CVE-2026-8643) twice, once under each of two GHSA
cross-references. The 5 distinct advisories: PYSEC-2026-196 (CVE-2026-8643),
PYSEC-2026-1795 (CVE-2025-8869), PYSEC-2026-1796 (CVE-2026-1703),
PYSEC-2026-2875 (CVE-2026-3219), PYSEC-2026-2876 (CVE-2026-6357). All 77
actual runtime dependencies (fastapi, sqlalchemy, supabase, pyjwt,
cryptography, starlette, uvicorn, uvloop, etc.) showed zero vulnerabilities.

**Fix:** `backend/websearch_service/Dockerfile` now pins
`pip install --no-cache-dir pip==26.1.2` (was a floating `--upgrade pip`,
which is cache-order-dependent and can silently keep shipping an old pip
indefinitely). Rebuilt with `--no-cache`; `pip --version` inside the rebuilt
image confirms `26.1.2`.

**Residual finding, accepted:** `pip-audit` itself still reports the same 6
CVEs against `pip==25.0.1`. This is **not** the system pip (verified fixed
above) — it is the `pip-25.0.1-py3-none-any.whl` bundled inside Python
3.12's stdlib `ensurepip` module
(`/usr/local/lib/python3.12/ensurepip/_bundled/`), part of the
`python:3.12-slim` base image digest the Dockerfile pins. `ensurepip`'s
bundled wheel is only used to bootstrap a *new* virtual environment (which
is exactly what `pip-audit` itself does to build an isolated audit
environment) — the running FastAPI application never creates a venv or
invokes `ensurepip`. **Runtime exposure: none for this deployment.**
Resolving it requires bumping the pinned base-image digest to a newer
`python:3.12-slim` release once one ships a newer `ensurepip` bundle — a
separate, deliberate change (this repo pins base images by immutable digest
specifically so that isn't done casually) and is a recommended follow-up,
not a blocker.

## 2. Frontend — npm audit (production dependencies)

Command: `npm audit --omit=dev` (what actually ships in the built bundle).

**Before fix:** 11 moderate-severity findings, all in the dependency chain
below.

| Package | Direct/transitive | Pulled in by | Advisory | Runtime exposure in this app |
| --- | --- | --- | --- | --- |
| `dompurify@3.4.1` | direct | `src/pages/academy/AcademyLesson.tsx` markdown sanitization | 9 advisories (GHSA-x4vx/76mc/hpcv/r47g/vxr8/gvmj/rp9w/cmwh/c2j3) — IN_PLACE-mode bypasses, hook-config pollution, SAFE_FOR_TEMPLATES bypass | The only call site is `DOMPurify.sanitize(content, { USE_PROFILES: { html: true } })` — no `IN_PLACE`, no custom hooks, no `SAFE_FOR_TEMPLATES`. Most listed bypasses require those options; not reachable via this call site as written, but a real fix exists and was applied (defense in depth). |
| `posthog-js@1.360.2` | direct | analytics init | pulls the two rows below transitively | Client-side analytics SDK; findings are in its OTLP telemetry-export path, not attacker-facing input |
| `@opentelemetry/*` (core, sdk-logs, sdk-metrics, sdk-trace-base, otlp-exporter-base, otlp-transformer, resources) | transitive | `posthog-js` | GHSA-8988-4f7v-96qf — unbounded memory allocation parsing W3C `baggage` header | Outbound telemetry export, not inbound attacker-controlled parsing in this app's usage |
| `protobufjs@7.6.3` | transitive | `posthog-js` → `@opentelemetry/otlp-transformer` | GHSA-j3f2-48v5-ccww — DoS via infinite loop parsing `.proto` option syntax | Only reachable if something feeds it an attacker-controlled `.proto` file; this app never does |

**Remediation:** `npm audit fix` (non-breaking, semver-range-respecting)
bumped `dompurify` to `3.4.12` and `posthog-js` to a version whose
`@opentelemetry/*`/`protobufjs` transitives are patched. `package.json`
ranges (`^3.3.3`, `^1.360.2`) were unchanged — only `package-lock.json`
resolutions moved within those ranges.

**Result:** `npm audit --omit=dev` → **0 vulnerabilities of any severity.**

## 3. Frontend — npm audit (dev-only tooling) and a real cross-platform lockfile bug found along the way

`npm audit` (full, including devDependencies) reports 4 vulnerable packages
(`metadata.vulnerabilities`: 1 moderate, 3 high, 4 total — verified via
`npm audit --json`), none of which ship in the built application:

| Package | Severity | Pulled in by | Why it doesn't ship |
| --- | --- | --- | --- |
| `js-yaml@4.2.0` | high (GHSA-52cp-r559-cp3m, quadratic CPU via YAML merge-key chains) | `@redocly/openapi-core@1.34.17` ← `openapi-typescript@7.13.0` | Build-time-only CLI tool (`npm run generate:api-types`) that parses this repo's own committed `docs/openapi.json`, never user/attacker input. `openapi-typescript@7.13.0` is its latest release and is still pinned to `@redocly/openapi-core@^1.x`; `@redocly/openapi-core@2.x` fixes this but isn't available as an `openapi-typescript` dependency yet — no non-breaking fix exists upstream today. Accepted; will resolve automatically on the next `openapi-typescript` major that adopts redocly 2.x. |
| `@redocly/openapi-core@1.34.17` | high | `openapi-typescript@7.13.0` | Same as above (the package the js-yaml chain hangs off of) |
| `esbuild@<=0.24.2` | moderate (GHSA-67mh-4wv8-2f99, dev server accepts cross-origin requests) | `vite` (dev dependency) | Only affects `npm run dev`'s local dev server; not present in `npm run build` output or any deployed artifact. |
| `vite@<=6.4.2` | high (depends on the vulnerable `esbuild` above) | direct devDependency | Same reasoning as `esbuild` — dev-server-only exposure. Fix requires `vite@8` (breaking, per `npm audit fix --force`) — deferred as a deliberate, tested upgrade, not a same-session dependency bump. |

**Real bug found and fixed while doing this triage:** the `npm audit fix` run
above was first executed on a Windows host, which produced a
`package-lock.json` that passed `npm ci` on Windows but **failed `npm ci` on
Linux** (`Missing: esbuild@0.28.1`, `@emnapi/core@1.11.2`,
`@emnapi/runtime@1.11.2` from lock file) — reproduced identically both
inside a `node:20-alpine` container (matching
`deployment/Dockerfile.frontend`'s base image) and via a full
`docker build --no-cache -f deployment/Dockerfile.frontend`. This would have
broken the real `ci.yml` Docker-build job and any Linux `npm ci` (CI itself
runs on `ubuntu-latest`). Fixed by regenerating `package-lock.json` from
inside a `node:20-alpine` container instead of the Windows host; verified
`npm ci` then succeeds both inside `node:20-alpine` directly and via a full
`docker build --no-cache` of `deployment/Dockerfile.frontend`. All frontend
checks (`tsc`, `eslint`, `vitest`, `npm run build`) were re-run against the
corrected lockfile and are unaffected.

## Summary

| Check | Before | After |
| --- | --- | --- |
| Backend pip-audit (system pip, actual runtime deps) | 5 distinct advisories (pip 25.0.1) | 0 (pip 26.1.2, verified) |
| Backend pip-audit residual (ensurepip stdlib bundle) | — | 5 distinct advisories, zero runtime exposure, base-image follow-up |
| Frontend npm audit, production deps | 11 moderate | **0** |
| Frontend npm audit, dev-only tooling | not previously reported | 4 packages (1 moderate, 3 high), all build-time-only, no shipped exposure |
| Frontend Docker build (Linux) | broken (undiscovered until this audit) | fixed and verified |
