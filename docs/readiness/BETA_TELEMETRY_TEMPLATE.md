# Beta Cohort Report — template

Copy per cohort window to `docs/readiness/reports/cohort-<n>-<dates>.md`.
Every number needs a source note; "unknown" is an acceptable value, a blank
is not. Instrumentation gaps discovered while filling this in go to
`docs/MONITORING_IMPLEMENTATION_PLAN.md`.

```markdown
# Cohort <n> report — <start date> → <end date>
Release SHA(s) serving during window: <list>

## Population
- Registered users (cumulative / new this window): __ / __   [source: core.users count]
- Daily active users (min–max, median): __                   [source: PostHog or auth logs]
- Peak concurrent users: __ (or "not instrumented")

## Funnel
- Signup completion rate (invite → activated account): __%
- Onboarding completion rate (started → onboarding_complete): __%  [core.user_profiles]

## Feature usage
- IRIS: conversations created __ / messages sent __ / distinct users __
- AI turn failure rate (post-fallback): __%                   [audit events]
- Paper trading: orders __ / distinct traders __ / integrity checks clean? __
- Academy: lessons opened __ / completed __ / quiz attempts __

## Quality
- Availability (outside-in): __%                              [SLO probe]
- Backend 5xx rate: __%                                       [Sentry/logs]
- Frontend error-affected sessions: __%                       [Sentry]
- p95 chat latency: __ s                                      [source: Sentry backend transaction p95 for /api/chat (or backend request-duration logs), UTC window: ____]

## Operations & cost
- Support requests: __ (themes: …)
- AI spend: $__ total / $__ per active user                   [provider dashboards]
- Infra spend delta: $__
- Incidents this window: <list with SEV + link>, or "none"
- Rollbacks: <list>, or "none"

## Feedback themes
1. …
2. …

## Gate assessment
Each exit criterion from STAGED_LAUNCH.md §4 with pass/fail + number.
Decision record: link to the committed LAUNCH_DECISION file.
```
