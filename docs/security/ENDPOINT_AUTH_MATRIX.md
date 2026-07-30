# Endpoint Authentication & Authorisation Matrix

Generated from a route inspection of `app/routes/*.py` + `app/main.py`. Auth is
enforced via FastAPI dependencies: `require_auth` (valid Supabase JWT),
`optional_auth` (public, personalises if a valid JWT is present), `_require_admin`
/ `_require_admin_caller` (admin profile), `verify_service_role` (service-role JWT).

Ownership: routes that read/write user data use the **verified** `user_id` from
the JWT claims (never client-supplied), and Supabase RLS scopes rows to that user.

Dependency census: **34** `require_auth`, **21** `_require_admin`, **4**
`_require_admin_caller`, **3** `optional_auth`, **1** service-role cron.

Legend — Auth: ✅ required · 🟡 optional · 🔑 service-role · 🛡️ admin.

| Route | Method | Auth | Role | Ownership | Rate limit | Tests / evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `/health`, `/health/live`, `/health/ready` | GET | ➖ public | — | — | — | `test_main.py` (health/live/ready) |
| `/` | GET | ➖ public | — | — | — | `test_main.py::test_root_endpoint` |
| `/api/search` | GET | ✅ | user | n/a | via limiter | `test_search.py`, `test_public_endpoint_auth_rate_limit.py` |
| `/api/news` | GET | 🟡 optional | — | n/a | ✅ anon+auth configs | `test_public_endpoint_auth_rate_limit.py` |
| `/api/stocks/ranking` | GET | 🟡 optional | — | n/a | limiter | `test_stock_ranking.py` |
| `/api/stocks/detail/{ticker}` | GET | 🟡 optional | — | n/a | limiter | `test_stock_ranking.py` |
| `/api/chat` | POST | ✅ | user | ✅ verified `user_id` | ✅ check + token accounting | `test_ai_proxy.py`, token-ceiling tests, `test_rate_limit*.py` |
| `/api/chat/title` | POST | ✅ | user | ✅ | ✅ | `test_ai_proxy.py` |
| `/api/ai/analyze-quantitative` | POST | ✅ | user | ✅ | ✅ | `test_ai_proxy.py` |
| `/api/meridian/onboard` | POST | ✅ | user | ✅ | limiter | `test_meridian_onboard.py` |
| `/api/meridian/refresh-context` | POST | ✅ | user | ✅ | limiter | `test_meridian_*` |
| `/api/meridian/refresh-all` | POST | 🔑 service-role (prod) | service_role | all-users cron | — | `test_meridian_refresh_all_auth.py` (accepts service-role JWT; rejects legacy secret in prod) |
| `/api/v1/**` (trade-engine: context, signals, engine status, prices, indicators, charting, tickers, portfolio, symbols, fundamentals, corporate-actions, financials, risk/valuation/returns, news, reference/*, ai/ticker) | GET | ✅ | user | read-only market data | limiter | `test_trade_engine.py` (uniform `Depends(require_auth)` — 30+ routes) |
| `/api/v1/trades/orders` | POST | ✅ | user | ✅ verified `user_id` | limiter | `test_trade_engine.py` |
| `/api/v1/ws/ticket` | POST | ✅ | user | ✅ single-use ticket bound to user | limiter | `ws_tickets` tests; WS query-param JWT removed (#205) |
| `/api/admin/**` (system-health, dataapi-query, users CRUD/suspend/restore/delete, purge-orphaned, trigger-*, jobs, scheduler-status, chat-dashboard, ai-budget status/override/reconcile) | GET/POST/DELETE | 🛡️ admin | Admin profile | admin-scoped | — | `test_admin_route_auth.py`, `test_admin_auth.py`, `test_admin_routes.py` (25 routes via `_require_admin`) |

## Rejection-scenario coverage (JWT boundary)

| Scenario | Enforced by | Test |
| --- | --- | --- |
| Missing token | `_extract_bearer_token` → 401 | `test_missing_token_raises_401`, `test_require_auth_rejects_missing_token` |
| Malformed token / header | `_get_unverified_jwt_header` → 401 | `test_malformed_*` (×3) |
| Expired token | PyJWT `exp` | `test_expired_token_returns_401` |
| Invalid signature | PyJWT decode w/ secret | `test_invalid_signature_returns_401`, `test_wrong_secret_raises_401` |
| Wrong issuer / **staging↔prod token** | `_verify_issuer` vs `SUPABASE_URL` | issuer mismatch → 401; `test_get_backend_env_rejects_legacy_in_production` |
| Missing `sub` claim | `require` claims | `test_missing_sub_claim_raises_401` |
| Unauthorised role (anon) | role gate | `test_anon_role_returns_403`, `test_wrong_role_raises_403` |
| Service-role isolation | `verify_service_role` | `test_valid_service_role_jwt`, refresh-all tests |
| ES256 / JWKS path | Supabase JWKS verifier | `test_es256_service_role_jwt_uses_supabase_jwks` |
| Auth disabled in prod | `validate_auth_configuration` + env validator | `test_production_auth_required_false_raises`, `test_auth_disabled` |

`verify_aud=False` is intentional: Supabase HS256 access tokens do not carry a
meaningful `aud` for this service; issuer + signature + expiry + required claims
are the trust anchors.

## Residual items to reach a fully-evidenced 9/10

1. **Explicit cross-user ownership test** at the HTTP layer (user A's JWT cannot
   read user B's chat/portfolio) — today enforced by verified `user_id` + RLS;
   add a direct IDOR-style regression.
2. **Disabled/deleted-user** request rejection test (suspend/restore lifecycle
   exists; add an end-to-end "suspended user is 403" test).
3. **JWKS rotation** behaviour test (retrieval-failure path is handled; add a
   key-rotation cache-refresh test).
4. **Google auth** stays disabled until password auth is verified in staging;
   validation tooling + checklist prepared (see `docs/security/GOOGLE_AUTH_CHECKLIST.md`).
