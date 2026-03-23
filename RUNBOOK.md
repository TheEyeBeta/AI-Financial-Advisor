# Local Debugging Runbook

## Start Frontend

```bash
npm run dev
# Opens at http://localhost:8080
```

## Start Backend

```bash
cd backend/websearch_service
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# Health check: http://localhost:8000/health
```

Or from project root:

```bash
npm run start:backend
```

## Required Environment Variables

### Frontend (`.env` at project root)

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_SENTRY_DSN` | (Optional) Override frontend Sentry DSN |

### Backend (`backend/websearch_service/.env`)

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Required for AI proxy |
| `SENTRY_DSN` | (Optional) Override backend Sentry DSN |
| `SUPABASE_URL` | Supabase URL for Meridian context |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service key |

## Run Playwright Tests

```bash
# Install browsers (first time only)
npx playwright install chromium

# Run all e2e tests
npm run test:e2e

# Run a specific test file
npx playwright test e2e/smoke-landing.spec.ts

# Run with visible browser
npx playwright test --headed

# Run with debug inspector
npm run test:e2e:debug

# Open last test report
npm run test:e2e:report
```

## Trigger a Frontend Sentry Test Event

Open browser console on the running app and run:

```js
import("@sentry/react").then(Sentry => {
  Sentry.captureException(new Error("Manual frontend test error"));
  console.log("Sent to Sentry");
});
```

Or temporarily add this to any component:

```tsx
throw new Error("Sentry frontend test");
```

Then check your Sentry dashboard (DE region) for the event.

## Trigger a Backend Sentry Test Event

```bash
curl http://localhost:8000/sentry-debug
# Returns 500 — the ZeroDivisionError is captured by Sentry
```

Check backend Sentry dashboard for the event.

## Where to Find Traces / Logs / Errors

| What | Where |
|---|---|
| Backend request logs | Terminal running uvicorn (structured: method, path, status, duration) |
| Backend exceptions | Terminal + Sentry dashboard |
| Backend audit log | `logs/audit.jsonl` (if `AI_AUDIT_LOG_PATH` is set) |
| Frontend errors | Browser DevTools console + Sentry dashboard |
| Playwright traces | `test-results/` directory (open with `npx playwright show-trace <file>`) |
| Playwright screenshots | `test-results/` directory (on failure) |
| Playwright HTML report | `playwright-report/index.html` (`npm run test:e2e:report`) |
| Sentry (frontend) | https://sentry.io — project linked to DSN in `src/main.tsx` |
| Sentry (backend) | https://sentry.io — project linked to DSN in `backend/.../main.py` |
