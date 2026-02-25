# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

FinanceAI is a two-service application: a **React/Vite frontend** (port 8080) and a **Python FastAPI backend** (port 8000). Data is stored in Supabase (external SaaS). See `README.md` for full details.

### Running services

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Frontend | `npm run dev` | 8080 | Vite dev server with HMR |
| Backend | `npm run start:backend` (or `cd backend/websearch_service && source venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000`) | 8000 | FastAPI with auto-reload; API docs at `/docs` |

### Lint / Test / Build commands

Refer to `package.json` scripts and `Makefile`. Key commands:

- **Lint**: `npm run lint`
- **Type-check**: `npm run type-check`
- **Frontend tests**: `npm test` (Vitest, 51 tests)
- **Backend tests**: `cd backend/websearch_service && source venv/bin/activate && pytest tests/ -v` (32 tests)
- **Build**: `npm run build`

### Non-obvious caveats

- Node.js 20 is required (`.nvmrc`). The VM has nvm installed; run `source $NVM_DIR/nvm.sh && nvm use 20` if node version is wrong.
- Python venv must be created with `python3.12-venv` system package installed (`sudo apt-get install -y python3.12-venv`). The venv lives at `backend/websearch_service/venv/`.
- Frontend `.env` requires `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_PYTHON_API_URL`. Copy from `config/env.example`. Without real Supabase credentials, the app renders but authentication and data features won't work.
- Backend `.env` requires `OPENAI_API_KEY` and `TAVILY_API_KEY` for AI/search features. Copy from `backend/websearch_service/.env.example`. The server starts without these but AI endpoints return errors.
- ESLint uses flat config (`eslint.config.js`) with ESLint v9; the `npm run lint` script still works despite using legacy `--ext` flags.
- Supabase email confirmation: the project setting "Confirm email" under Authentication > Providers > Email controls whether new signups require email verification. If enabled, you cannot programmatically confirm users without a `SUPABASE_SERVICE_ROLE_KEY`. This is a Supabase **Auth** setting (not the application `users` table). Backend AI/search features can always be tested independently via `http://localhost:8000/docs` (Swagger UI).
- After signup, a 4-step onboarding wizard runs (age, marital status, investment goal, risk level). Onboarding must complete before the dashboard is accessible.
- The backend loads `.env` from `backend/websearch_service/.env` automatically via `python-dotenv`. When starting via `npm run start:backend`, the script also sources the `.env` file.
- Frontend dev server binds to `::` (all interfaces) on port 8080. Backend binds to `0.0.0.0` on port 8000.
- The "Trade Engine" (WebSocket at `ws://localhost:8000/ws/live`) is an optional external service not included in this repo. The frontend logs `[TradeEngine WS] Disconnected (code: 1006)` errors in the console when it's unavailable — this is expected and does not block core features.
- Paper trading form submissions can fail silently (no error toast) due to intermittent Supabase write issues. This is a pre-existing app-level bug, not a setup issue. When trades succeed, a green toast appears and positions/history/journal update correctly.
