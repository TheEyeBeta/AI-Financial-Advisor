# RPO / RTO measurement worksheet

**Status: NOT VERIFIED.** No fields below have real values yet — this is
the blank worksheet to fill in during an actual drill. Copy this file (or
fill in a dated copy) each time the drill runs; don't overwrite prior
results.

## Targets (from `docs/SLO.md`)

- **RPO (restore-point objective):** ≤ 24 hours
- **RTO (restore-time objective):** ≤ 4 hours

## RPO measurement

RPO is not something you "measure" during the drill itself — it's a
property of your backup *cadence*, checked at drill time as evidence.

| Field | Value |
|---|---|
| Backup timestamp used for this drill | _(fill in)_ |
| Drill start timestamp | _(fill in)_ |
| Gap (drill start − backup timestamp) | _(fill in — this is the RPO this backup would have delivered if the incident had happened at drill start)_ |
| Within 24h target? | _(yes/no)_ |
| `BACKUP_VERIFICATION_CHECKLIST.md` completed for this backup? | _(yes/no + date)_ |

## RTO measurement

Record a timestamp at **every** step below — not just start/end. A step
taking unexpectedly long is exactly the data this worksheet exists to
capture; don't compress it into a single total.

| Step | Timestamp | Elapsed since previous step | Notes |
|---|---|---|---|
| 1. Incident/drill declared, RTO clock starts | | — | |
| 2. Isolated Supabase project ready | | | New project or pre-existing throwaway? |
| 3. Backup restore initiated | | | Platform restore or `pg_restore`? |
| 4. Backup restore completed | | | |
| 5. `alembic_version` reconciled | | | Matched recorded value, or had to `stamp`? |
| 6. `alembic upgrade head` completed | | | Any migration failures/retries? |
| 7. Migration validation (`MIGRATION_VALIDATION_PROCEDURE.md`) passed | | | |
| 8. Backend started against restored DB | | | |
| 9. `/health/ready` reports `ready` | | | |
| 10. Data-integrity verification queries run | | | All "Expected: 0" queries actually returned 0? |
| 11. RTO clock stops (system verified-correct and could serve traffic) | | | |

**Total elapsed (row 11 − row 1):** _(fill in)_
**Within 4h target?** _(yes/no)_

## If any step failed or took unusually long

Document it here, not just in prose elsewhere — this is the whole point of
a worksheet over a narrative writeup:

| Step # | What went wrong | Manual repair performed | Time added |
|---|---|---|---|
| | | | |

## Bottleneck identification

If total elapsed time exceeded 4 hours, or any single step took an
outsized share of the total, name the bottleneck explicitly:

- **Bottleneck:** _(fill in — e.g. "Supabase project provisioning took 90
  minutes," "migration step X failed twice before succeeding," "no one
  had `pg_restore` installed locally and had to install it mid-drill")_
- **Is this fixable before the next drill?** _(yes/no + plan)_

## Sign-off

- **Drill conducted by:** _(name)_
- **Date:** _(date)_
- **Overall result:** _(RPO met / RTO met / both met / neither met)_
- **Evidence recorded in:** `RECOVERY_EVIDENCE_TEMPLATE.md` (dated copy: _____)
