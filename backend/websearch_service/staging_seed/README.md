# staging_seed

Idempotent synthetic-data seeder and environment-isolation guard for the
**staging** database only. See `backend/websearch_service/AGENTS.md` and the
repo root `AGENTS.md` for the constraints this package must respect.

## What it seeds

Per run (default 200 users, override with `STAGING_SEED_USER_COUNT`):

| Entity | Table(s) |
| --- | --- |
| Users + onboarding state | `core.users` (`onboarding_complete`, risk/experience/goal fields) |
| Chats & messages | `ai.chats`, `ai.chat_messages` |
| AI turn requests (completed/failed/processing/cancelled/pending) | `ai.chat_turn_requests` |
| Paper-trading portfolios | `trading.portfolio_history`, `trading.open_positions` |
| Journal entries | `trading.trade_journal` (BUY/SELL, respects the oversell trigger) |
| Academy progress | `academy.profiles`, `academy.user_lesson_progress` |
| Admin jobs | `core.admin_jobs` |
| Audit events | `core.user_account_audit` |

Every row is generated from `STAGING_SEED_RANDOM_SEED` (default `424242`) via
`random.Random` — the same seed always produces the same synthetic
users/content. Every primary key is a UUIDv5 derived from
`(seed, entity kind, index)`, and every insert uses
`ON CONFLICT ... DO NOTHING` (or updates by natural key), so **re-running the
seeder against a target that already has this data is a no-op except for
newly-added users if you raise `STAGING_SEED_USER_COUNT`.**

Users are created through the **Supabase Auth Admin API**
(`auth.admin.create_user`, `email_confirm=true`, no password) — never by
writing to `auth.users` directly — so the existing
`core.handle_new_user()` trigger provisions `core.users` exactly as it does
for a real signup. Admin API calls never send email or SMS (only
`signUp`/`inviteUserByEmail`/`resetPasswordForEmail` do that).

### Synthetic markers

- Emails: `synthetic-seed-XXXX@staging.invalid` — `.invalid` is an
  IANA-reserved (RFC 2606), permanently non-resolvable TLD. Nothing sent to
  that domain can ever be delivered.
- Names: combinations of a fixed synthetic-word list (`Synthetic0007`,
  `Sandbox0142`, last names `Alpha`/`Beta`/`Gamma`/…) — never real-looking.
- `core.admin_jobs.actor_id` and `core.user_account_audit.actor` are both set
  to `synthetic-seed-script`.

`cleanup`/`reset` and the integrity checks in `verify` all key off these same
markers, so they can never touch a real user's data.

## Safety gates

Every **mutating** command (`seed`, `cleanup`, `reset`) refuses to run
unless **all** of the following hold:

1. `ENVIRONMENT` is not `production`.
2. The target's Supabase project ref and hostname (from `SUPABASE_URL`) and
   the database hostname (from `ALEMBIC_DATABASE_URL`) do not appear in
   `STAGING_SEED_PRODUCTION_DENYLIST` (comma-separated).
3. `ALLOW_SYNTHETIC_SEED=true` was explicitly set.
4. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a database URL
   (`ALEMBIC_DATABASE_URL` / `DATABASE_URL` / `SUPABASE_DB_URL`) are present.

`preflight` and `verify` are read-only and only enforce gates 1–2 (they
never require `ALLOW_SYNTHETIC_SEED`, since they don't write).

See `staging_seed/guard.py` for the exact logic and
`tests/test_staging_seed_guard.py` for the tests proving refusal.

## Exact staging execution commands

Run from `backend/websearch_service`, with the staging project's env vars
set (get these from the Supabase **staging** project settings — never from
production):

```bash
export ENVIRONMENT=staging
export ALLOW_SYNTHETIC_SEED=true
export SUPABASE_URL=https://<staging-project-ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<staging-service-role-key>
export ALEMBIC_DATABASE_URL=postgresql://postgres:<password>@<staging-db-host>:5432/postgres
# Optional but recommended defense-in-depth:
export STAGING_SEED_PRODUCTION_DENYLIST=<prod-project-ref>,<prod-db-host>

# 1. Confirm you're pointed at staging before touching anything:
python -m staging_seed preflight

# 2. Seed (idempotent — safe to re-run):
python -m staging_seed seed

# 3. Confirm the data landed and looks right:
python -m staging_seed verify

# 4. Tear it down when you're done:
python -m staging_seed cleanup

# ...or wipe and reseed in one step:
python -m staging_seed reset
```

Optional tuning:

```bash
export STAGING_SEED_RANDOM_SEED=424242   # default; change for a different fixed dataset
export STAGING_SEED_USER_COUNT=200       # default; minimum enforced is 200
```

### Via GitHub Actions

`.github/workflows/staging-seed.yml` is `workflow_dispatch`-only, bound to
the **staging** GitHub Environment (so only that environment's protected
secrets — `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`,
`STAGING_DATABASE_URL`, optionally `STAGING_SEED_PRODUCTION_DENYLIST` — are
exposed, and any required-reviewer rules on the environment apply). Trigger
it from the Actions tab, choosing `preflight` / `seed` / `cleanup` /
`reset` / `verify` as the command.

## Running the tests

```bash
cd backend/websearch_service
pytest tests/test_staging_seed_guard.py tests/test_staging_seed_idempotency.py -v
```

These are pure unit tests (no network, no database) — they prove the
production-refusal gates and the idempotency contract (every INSERT has
`ON CONFLICT`, every DELETE is scoped by a synthetic marker, `ensure_users`
skips users that already exist and never re-invokes the Admin API for them).

## Known limitation

`core.users.id` is generated by Postgres (`DEFAULT uuid_generate_v4()`) via
the `core.handle_new_user()` trigger, not by this seeder — so it is *not* a
pure function of the seed. What *is* guaranteed deterministic and
idempotent: which synthetic users exist (by email), their profile fields,
and every child row's own primary key and content. Re-seeding an existing
target reuses the same `core.users.id` it created the first time; a fresh
empty target will get new (but internally consistent) ids on next seed.

Several `academy.*` tables predate Alembic tracking (see
`sql/README.md`) and aren't referenced in this session's environment with a
formal `CREATE TABLE`. `seed_academy` introspects `information_schema`
at runtime and skips a table gracefully (with a warning) if it isn't
present, rather than guessing at an unverified schema.
