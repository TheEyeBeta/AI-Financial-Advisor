# Backup verification checklist

**Status: NOT VERIFIED.** This checklist has not been executed against a
real backup. It exists to be run once, by a human with production Supabase
access, and the results recorded in `RECOVERY_EVIDENCE_TEMPLATE.md`.

A backup is not proven until it has been restored (see
`ISOLATED_RESTORE_PROCEDURE.md`) — this checklist only verifies that a
backup *exists and is plausibly usable*, which is a precondition for the
restore, not a substitute for it.

## 1. Backup existence and recency

- [ ] Supabase Dashboard → Database → Backups shows at least one completed
      daily backup within the last 24 hours (matches SLO 9, RPO ≤24h,
      `docs/SLO.md`).
- [ ] The backup's timestamp is recorded (this becomes the RPO measurement
      baseline in `RPO_RTO_WORKSHEET.md`).
- [ ] No backup failure is shown for the prior 7 days (a single recent
      success does not rule out a flapping backup job).

## 2. Backup scope

- [ ] Confirm the backup covers all six application schemas: `core`, `ai`,
      `trading`, `market`, `academy`, `meridian` (per `AGENTS.md`'s
      architecture map and `docs/DB_RECOVERY.md`'s `pg_dump --schema=...`
      flags) — a platform-level Supabase backup should cover the whole
      database by default; confirm this is actually true for your plan
      tier rather than assuming it.
- [ ] Confirm `auth.users` and other `auth.*` tables are included (Supabase
      manages this schema; verify it isn't excluded by any custom backup
      configuration).
- [ ] Confirm the current `public.alembic_version` value is captured
      alongside the backup timestamp (record it manually — see
      `docs/DB_RECOVERY.md`'s "Record the current alembic_version" step;
      this checklist doesn't replace that step, it verifies it was done).

## 3. Backup integrity (as far as verifiable without restoring)

- [ ] If a logical dump (`pg_dump`) is also taken per `docs/DB_RECOVERY.md`,
      confirm the dump file is non-empty and its size is consistent with
      recent dumps (a suspiciously small dump is a red flag before you ever
      attempt a restore).
- [ ] If checksums or dump-file hashes are recorded elsewhere in your
      deployment tooling, confirm one exists for the backup under review.
- [ ] Confirm the backup storage location itself has redundancy/durability
      guarantees appropriate to a production data source (this is a
      Supabase-platform property to confirm, not something this repo
      configures).

## 4. Access verification

- [ ] Confirm at least one human (not just an automated process) currently
      has the access needed to initiate a restore from this backup, in an
      emergency, without waiting on a third party.
- [ ] Confirm that access does not depend on a single person being
      available (bus-factor check for the restore procedure itself).

## 5. Record-keeping

- [ ] This checklist's completion (date, who ran it, pass/fail per section)
      is logged in `RECOVERY_EVIDENCE_TEMPLATE.md`.
- [ ] Any failed item above is treated as an open incident against SLO 9
      (RPO) until resolved — not silently noted and left.

---

Every checkbox above is unchecked until a human actually performs it.
Checking a box without doing the verification is worse than leaving this
document blank.
