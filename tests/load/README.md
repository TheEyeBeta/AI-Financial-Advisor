# Load testing — Phase 4 (readiness spec)

**Status: infrastructure-independent work only.** Every script here has been
written and reviewed (syntax-checked, safety logic traced by hand and
exercised via `scripts/run-load-test.sh --dry-run`), but **none of it has
been executed against a real target** — this session's network egress is
blocked from reaching any staging host, and even once that's open, the
known staging environment currently shares Supabase/Redis/AI quota with
production, which the safety gate is specifically designed to refuse. Do
not treat any number in this directory as a real measurement. No
`tests/load/results/*.json` file exists yet because no run has happened.

## What's here

```
tests/load/
  lib/
    safety.js        — the safety gate every script imports and calls first
    reporting.js      — shared handleSummary(): machine + human report generation
  helpers.js           — shared request helpers (existing, extended with run-ID headers)
  profile-a-normal-browsing.js   — Test A
  profile-b-busy-beta.js          — Test B (AI-backed)
  profile-c-burst.js              — Test C (AI-backed)
  profile-d-soak.js               — Test D (AI-backed, long-running)
  chat-load.js         — ad-hoc single-scenario chat load (existing, hardened)
  search-load.js       — ad-hoc single-scenario search load (existing, hardened)
  paper-trading-load.js — ad-hoc direct-write paper-trading load (existing, hardened)
  failure-injection/    — Test E: documented, operator-controlled procedures (never automated)
  setup/
    manage-test-users.mjs — Node script (NOT k6) for idempotent test-user provisioning/cleanup
  results/              — generated reports land here (empty until a real run happens)
```

## Commands

```bash
# See the full plan for a profile without sending any request:
scripts/run-load-test.sh a --dry-run

# Run for real (only after every safety variable below is set and true):
scripts/run-load-test.sh a
scripts/run-load-test.sh b   # AI-backed
scripts/run-load-test.sh c   # AI-backed
scripts/run-load-test.sh d   # AI-backed, long-running — LOAD_TEST_DURATION defaults to 4h
scripts/run-load-test.sh chat
scripts/run-load-test.sh search
scripts/run-load-test.sh paper-trading

# Provision/cleanup dedicated test users (separate from k6, uses service-role key):
node tests/load/setup/manage-test-users.mjs setup   --run-id "$LOAD_TEST_RUN_ID" --count 150
node tests/load/setup/manage-test-users.mjs cleanup --run-id "$LOAD_TEST_RUN_ID" --dry-run
node tests/load/setup/manage-test-users.mjs cleanup --run-id "$LOAD_TEST_RUN_ID"
```

k6 itself is not installed in this environment and was not reachable to
install (same network policy that blocks the staging URL) — install it
locally per <https://k6.io/docs/get-started/installation/> before running
anything for real. `scripts/run-load-test.sh --dry-run` works without k6
installed (it prints the bash-level plan; it just skips k6's own
DRY_RUN=true summary if the binary isn't present).

## Required environment variables

| Variable | Required for | Purpose |
|---|---|---|
| `LOAD_TEST_CONFIRMED=true` | every run | Explicit "an operator reviewed this" confirmation |
| `BACKEND_URL` | every run | Target backend base URL |
| `LOAD_TEST_ALLOWED_HOSTS` | every run | Comma-separated allowlist; target must match |
| `LOAD_TEST_PRODUCTION_HOSTNAMES` | every run | Comma-separated denylist of real production hosts — **you must state these explicitly**, this repo has no committed source of truth for them |
| `LOAD_TEST_ISOLATED_INFRA_CONFIRMED=true` | every run | Confirms target's Supabase/Redis/AI quota are dedicated, not shared with production |
| `K6_AUTH_TOKEN` / `K6_AUTH_TOKENS` / `K6_AUTH_TOKENS_JSON` | every run | Test-user session JWT(s) |
| `LOAD_TEST_DEDICATED_USERS_CONFIRMED=true` | every run | Confirms those credentials are dedicated test users |
| `LOAD_TEST_MAX_VUS` | every run | Hard cap on virtual users; profiles clamp to `min(profile default, this)` |
| `LOAD_TEST_MAX_DURATION_SECONDS` | every run | Hard cap on duration; Test D validates its requested duration against this |
| `LOAD_TEST_RUN_ID` | every run | Unique ID attached to every request (`X-Load-Test-Run-Id` header) and used for cleanup scoping |
| `ALLOW_PAID_AI_LOAD=true` | Tests B, C, D, `chat` | AI requests cost real provider spend |
| `ALLOW_FAILURE_INJECTION=true` | Test E only | See `failure-injection/README.md` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Tests A-D | Supabase REST reads |
| `SUPABASE_SERVICE_ROLE_KEY`, `PAPER_TRADING_USER_ID` | `paper-trading` only | Direct-write path — **never printed, never sent to k6's own log/debug output; keep `--http-debug` off** |
| `LOAD_TEST_USER_EMAIL_DOMAIN` | `manage-test-users.mjs` | Must end in `.invalid` or `.test` (RFC 2606) — script refuses otherwise |
| `LOAD_TEST_ENVIRONMENT_LABEL`, `LOAD_TEST_GIT_SHA` | reporting | Labels embedded in generated reports |
| `LOAD_TEST_DURATION` | optional | Overrides profile default scenario duration (e.g. `10m`, `4h`) |
| `DRY_RUN=true` | optional | Validation mode — see below |

## Safety controls

Every script (`tests/load/lib/safety.js`, called at module top-level so it
runs before any scenario) refuses to run unless **all** of the following are
true — this is not configurable per-script, it's the same gate everywhere:

1. `LOAD_TEST_CONFIRMED=true`
2. Target hostname is explicitly in `LOAD_TEST_ALLOWED_HOSTS`
3. Target hostname is **not** in `LOAD_TEST_PRODUCTION_HOSTNAMES`
4. `LOAD_TEST_ISOLATED_INFRA_CONFIRMED=true`
5. Dedicated test-user credentials supplied and `LOAD_TEST_DEDICATED_USERS_CONFIRMED=true`
6. `LOAD_TEST_MAX_VUS` set to a positive integer
7. `LOAD_TEST_MAX_DURATION_SECONDS` set to a positive integer
8. AI-backed profiles additionally require `ALLOW_PAID_AI_LOAD=true`
9. Failure-injection additionally requires `ALLOW_FAILURE_INJECTION=true`
10. `LOAD_TEST_RUN_ID` set — attached to every request as `X-Load-Test-Run-Id`

`scripts/run-load-test.sh` performs the same checks in bash *before*
invoking k6 at all, so a misconfigured run never even starts the k6
process. The k6-level checks in `lib/safety.js` exist as defense in depth
for `k6 run <script>` invoked directly.

### `--dry-run` / `DRY_RUN=true`

`scripts/run-load-test.sh <profile> --dry-run` prints, without sending a
single request:
- Target environment
- Test profile
- Maximum users (requested vs. `LOAD_TEST_MAX_VUS` ceiling)
- Maximum duration
- AI request budget (0 for non-AI profiles)
- Expected request volume
- Every required environment variable and whether it's currently set
- Whether destructive or failure-injection behavior is enabled (always
  `false` for A-D and the ad-hoc scripts — Test E is never run by this
  script at all)

Unlike a real run, dry-run mode never throws on a missing variable — it
reports what's missing instead, since the entire point is to show you what
you'd need before committing to a real run.

## Test data — setup and cleanup

`tests/load/setup/manage-test-users.mjs` (plain Node, run directly — never
inside k6, so the service-role key never appears in k6 output):

- **Unique run-scoped naming:** every user is `loadtest-<runId>-<n>@<domain>`,
  where `<domain>` must end in `.invalid` or `.test` — the script refuses to
  run otherwise, so a misconfigured cleanup can never be mistaken for
  touching a real mailbox/account.
- **Idempotent setup:** re-running `setup` for the same run ID skips users
  that already exist rather than erroring or duplicating.
- **Cleanup by run ID only:** `cleanup --run-id <id>` matches strictly on
  the `loadtest-<runId>-` email prefix *and* a `user_metadata.load_test_run_id`
  tag set at creation — never a broad "delete all test users" or "delete
  all users" sweep, and it never touches a row that doesn't match both.
- **`--dry-run`** on cleanup lists what would be deleted without deleting
  anything.
- Deleting the `auth.users` row cascades to `core.users` and dependent rows
  via the schema's existing `ON DELETE CASCADE` — no separate broad-table
  delete is issued by this script.
- The script never prints `SUPABASE_SERVICE_ROLE_KEY` or any generated
  session token.

**This script does not print usable bearer JWTs for the created users** —
see the note in its own output. Populate `K6_AUTH_TOKENS_JSON` by signing
each test account in through the normal password-grant flow from a trusted,
non-k6, non-browser process, and pass only the resulting short-lived JWTs
into k6.

## Reporting

Every profile script (A-D and the three ad-hoc scripts) uses
`tests/load/lib/reporting.js`'s `buildHandleSummary()`, which writes two
files per run to `tests/load/results/`:

- `<profile>-<runId>.json` — machine-readable: test date, git SHA,
  environment, profile, concurrency, request count, req/s, p50/p95/p99,
  error rate, HTTP status distribution (where tagged), AI first-token/
  completion latency (AI profiles only), threshold breaches.
- `<profile>-<runId>.md` — the same, formatted for humans.

**Bottleneck and recommended-safe-operating-limit are never computed
automatically** — those fields are explicitly left for an operator to fill
in (`LOAD_TEST_BOTTLENECK_NOTE` / `LOAD_TEST_SAFE_LIMIT_NOTE` env vars, or
hand-edit the generated report) after actually reviewing a run. A blank
value there means "not yet analyzed," never "no bottleneck found."

k6 `thresholds` in every profile encode the relevant `docs/SLO.md` targets
(e.g. `http_req_duration: ["p(95)<500", "p(99)<1500"]`,
`chat_first_token_ms: ["p(95)<8000"]`) — a threshold breach fails the k6
run's exit code, which is what `threshold_breaches` in the report reflects.

## Tests that can run with mocked providers

None of A-D can run fully mocked — they exercise the real backend/Supabase
stack by design (that's the point of a load test). What *can* be exercised
without a live target:
- `scripts/run-load-test.sh <profile> --dry-run` — full safety-gate and
  plan validation, no network calls.
- `node --check` on every script (already done, all pass) — syntax only.
- The existing application-level tests (`npm run test`, `pytest`) already
  cover the code paths these scripts exercise from the *application* side
  (e.g. `src/lib/__tests__/paper-trading-ledger.test.ts`,
  `backend/websearch_service/tests/integration/test_rate_limiting.py`) —
  those are real, already-passing tests, but they are not load tests.

## Tests requiring isolated staging

All of A, B, C, D, and every Test E scenario require a target that is
**genuinely isolated** from production (dedicated Supabase project, Redis
instance, and AI provider quota) — not just a different hostname. The
currently known staging URL
(`ai-financial-advisor-backend-staging.up.railway.app`) does **not**
qualify as-is; it was confirmed to share resources with production. Running
any of B/C/D against it would violate the readiness spec's explicit "do not
load-test production user data" requirement and the `LOAD_TEST_ISOLATED_INFRA_CONFIRMED`
gate is designed to block exactly this.

## Exact infrastructure checklist before execution

1. A staging Supabase project that is **not** the production project (own
   URL, own service-role key, own data).
2. A staging Redis instance that is **not** the production Redis.
3. A staging Railway (or equivalent) backend deployment pointed at #1 and
   #2, reachable from wherever k6 runs.
4. Network egress from the k6-running machine to that backend's hostname
   (this session's egress is currently blocked to the known staging host).
5. `LOAD_TEST_PRODUCTION_HOSTNAMES` populated with the real production
   frontend/backend hostnames.
6. `LOAD_TEST_ALLOWED_HOSTS` populated with the real staging hostname.
7. Dedicated test users provisioned via `manage-test-users.mjs setup`, with
   session JWTs obtained through a trusted non-k6 process.
8. An explicit, capped AI provider budget/quota on the staging project
   before running B, C, or D (`ALLOW_PAID_AI_LOAD=true` is a confirmation,
   not a spend limit — set an actual provider-side cap too).
9. k6 installed on whatever machine will execute the run.
10. A decision on where `tests/load/results/*.json` reports get archived
    long-term (this repo just writes them locally; nothing ships them
    anywhere durable yet).

Until all ten are true, do not run Tests A-D for real, and Test E never
runs automatically regardless.
