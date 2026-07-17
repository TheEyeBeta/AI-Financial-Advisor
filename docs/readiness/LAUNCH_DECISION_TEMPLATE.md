# Launch / Promotion Decision Record — template

Copy to `docs/readiness/decisions/<date>-cohort-<n>.md` for every cohort
gate (including "hold" decisions — a decision not to expand is still a
decision record). No field may be left blank; "unknown" must be explained.

```text
Release SHA:            <full sha — must match /health release.git_sha and the
                         frontend release-sha meta tag at decision time>
Cohort:                 <current> → <proposed>
Observation period:     <start> → <end> (UTC)

SLO status:             availability __% | 5xx __% | p95 chat __s
                        (thresholds: STAGED_LAUNCH.md §4 — state pass/fail each)
Incidents:              <list w/ SEV + resolution state, or "none">
Critical-journey status:<summary from docs/tests/critical-journeys.json —
                         any P0 not AUTOMATED_TEST_PASSED listed here with
                         its manual-evidence reference>
Security status:        <open security issues by severity; review-package /
                         pentest state; secret-scan clean?>
Accessibility status:   <axe CI state; SR script runs logged; open a11y issues>
Cost status:            $__ per active user vs projection; budget alerts state
Known risks:            <carried risks accepted for this expansion, each with
                         owner + mitigation>

Decision:               EXPAND to cohort <n> / HOLD / SHRINK-PAUSE
Rationale:              <two sentences minimum — tie to the numbers above>
Approver:               <name, date — must be the promotion decision owner
                         per OWNERSHIP.md>
Rollback target:        <SHA + the admission actions that reverse this
                         decision (pause signups, suspend invites, suspend
                         cohort accounts)>
```

Hard-rule check (STAGED_LAUNCH.md §5). Every rule must carry an explicit
`PASS` or `FAIL` with evidence and an assessment timestamp — a blank is
indistinguishable from "not assessed" and invalidates the record. `EXPAND`
is rejected unless **all six are explicitly PASS**:

```text
No unresolved SEV-1/SEV-2:   PASS/FAIL  evidence: ______  assessed: ____ UTC
No data-integrity defect:    PASS/FAIL  evidence: ______  assessed: ____ UTC
No mandatory CI failure:     PASS/FAIL  evidence: ______  assessed: ____ UTC
No critical a11y defect:     PASS/FAIL  evidence: ______  assessed: ____ UTC
AI cost controlled:          PASS/FAIL  evidence: ______  assessed: ____ UTC
No active incident now:      PASS/FAIL  evidence: ______  assessed: ____ UTC
```
