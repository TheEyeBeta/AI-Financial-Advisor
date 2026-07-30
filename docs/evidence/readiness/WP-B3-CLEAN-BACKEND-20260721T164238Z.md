# Evidence — WP-B3-CLEAN-BACKEND: EXECUTED: full backend suite + CI gates + global coverage on clean Linux

- **Run ID:** `WP-B3-CLEAN-BACKEND-20260721T164238Z`
- **Result:** **PASS**
- **Environment:** clean-linux-ubuntu2204-py31012  ·  **App version:** readiness-batch3
- **Commit:** `5bad7e946653d44e41482637df05f2b0a1a5d076`
- **Started:** 2026-07-21T16:42:38Z  ·  **Finished:** 2026-07-21T16:42:38Z
- **Command:** `python -m pytest -o addopts='' -q  (Ubuntu 22.04, Python 3.10.12, pytest 9.1.1)`
- **Content SHA-256:** `fba34ff6d8a9d0491b4c81321abf09b46fcbb45efc2a191c26c0c8a0ba6639b5`

## Assertions
- 1247 passed / 41 skipped / 0 failed, exit 0
- env-schema gate: safe=exit0, unsafe=exit1
- evidence-schema gate: 15 verified
- network-guard gate: blocked
- global backend coverage 76% (> 69% CI floor)

## Metrics

| Metric | Value |
| --- | --- |
| passed | 1247 |
| skipped | 41 |
| failed | 0 |
| exit_code | 0 |
| duration_s | 37 |
| global_coverage_pct | 76 |
| auth_pct | 93 |
| budget_pct | 84 |

## Artifacts
- `backend/websearch_service/tests/`

## Reviewer notes
_(pending review)_
