# Runbook: Database schema mismatch

**Rehearsed:** NO

- **Trigger:** `/health/ready` `schema_revision` component `error` — the DB's `public.alembic_version` differs from the revision the running build expects (#208 guard).
- **Severity:** SEV-2 (instance correctly refuses to serve).
- **User impact:** backend held out of service until versions align.

## Immediate containment
This guard exists to *prevent* damage — do not bypass it. Identify which side is behind:

```bash
curl -sS https://<backend>/health/ready | jq '(.detail // .) | .components.schema_revision'
# {"status":"error","expected":"00xx_…","actual":"00yy_…"}
```

- `actual` < `expected`: new build deployed, migration not applied.
- `actual` > `expected`: old build (rollback?) running against a newer schema.

## Diagnostics
```bash
cd backend/websearch_service
alembic -c alembic.ini history | head           # revision graph
alembic -c alembic.ini heads
```
Supabase SQL editor: `SELECT version_num FROM public.alembic_version;`

## Dashboards / logs
Railway deploy history (which SHA is live); `docs/recovery/MIGRATION_VALIDATION_PROCEDURE.md`.

## Recovery
- **Build ahead of DB:** apply the migration per the validated procedure (`docs/recovery/MIGRATION_VALIDATION_PROCEDURE.md`): backup confirmation → `alembic upgrade head` against production with `ALEMBIC_DATABASE_URL` → readiness re-check. Never apply raw `sql/*.sql` as a shortcut (AGENTS.md forbidden zone).
- **Build behind DB (rollback scenario):** prefer rolling the *code* forward to the schema-compatible SHA. Alembic downgrades against production data are a last resort — see limitations in `../readiness/ROLLBACK.md` §Migrations.

## Rollback
`../readiness/ROLLBACK.md` §Database (forward-fix strategy is the default posture).

## Validation
`schema_revision.status == "ok"`, readiness green, smoke round-trip touching a migrated table.

## Communication
Usually deploy-window internal; SEV-2 comms if user-visible beyond 30 min.

## Post-incident
Determine why the promotion order broke (migration should deploy with its build); tighten the release checklist step that verified migration application.
