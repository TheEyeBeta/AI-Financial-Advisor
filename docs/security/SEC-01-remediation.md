# SEC-01 Remediation: Client-Side API Key Exposure

## Audit Summary

The following client-side key exposure patterns were identified and removed:

- `src/services/api.ts`
  - `import.meta.env.VITE_OPENAI_API_KEY`
  - `import.meta.env.VITE_DEEPSEEK_API_KEY`
  - direct calls to `https://api.openai.com/v1/chat/completions`
  - direct calls to `https://api.deepseek.com/v1/chat/completions`
- `env.example`
  - Removed `VITE_OPENAI_API_KEY` and `VITE_DEEPSEEK_API_KEY`
- `README.md`
  - Updated setup guidance to keep provider keys server-side only

## New Backend Proxy Endpoints

Implemented in `backend/websearch_service/app/routes/ai_proxy.py`:

- `POST /api/chat`
  - Request: `{ messages?: [{role, content}], message?: string, user_id?: string, temperature?: number, max_tokens?: number }`
  - Response: `{ response: string }`
- `POST /api/chat/title`
  - Request: `{ first_message: string }`
  - Response: `{ title: string }`
- `POST /api/ai/analyze-quantitative`
  - Request: `{ quantitative_data: Record<string, number> }`
  - Response: `{ response: string }`

## Security Controls Added

- Server-side secret management:
  - Uses backend env var `OPENAI_API_KEY`
  - No provider key usage from Vite/browser env
- Basic abuse control:
  - In-memory IP-based rate limit (`30 req/min/client`)
  - 429 responses when exceeded

## Frontend Changes

- AI chat/title/quantitative analysis now call backend endpoints only.
- If backend URL is missing, frontend returns a safe configuration error.

## Ops Follow-up (Required)

1. Rotate any previously exposed OpenAI/Deepseek keys immediately.
2. Revoke old keys in provider dashboards.
3. Configure `OPENAI_API_KEY` on backend deployment only.
4. Add infrastructure-level rate limiting and monitoring (WAF/API gateway) for production.
