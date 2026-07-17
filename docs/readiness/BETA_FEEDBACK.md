# Beta Feedback Mechanism — structure and data-minimization rules

**Owner:** TheEyeBeta · **Created:** 2026-07-16 (Phase 10)

Channel for the beta: a structured form (Google Form / Tally — owner choice,
EXTERNAL to set up) linked from the app footer's support address, plus direct
email fallback. Submissions are triaged weekly into GitHub issues with the
`beta-feedback` label.

## Form schema

| Field | Type | Required | Values |
| --- | --- | --- | --- |
| Category | select | yes | Bug / Confusing UX / Feature request / Performance / Accessibility / Content accuracy (IRIS or Academy) / Other |
| Severity (reporter's view) | select | yes | Blocks me completely / Major annoyance / Minor / Idea |
| Feature area | select | yes | Sign-in & account / Onboarding / IRIS chat / Paper trading / Academy / Dashboard / Other |
| Browser & device | select + free text | yes | Chrome / Safari / Firefox / Edge / Other × Desktop / Android / iOS |
| What happened? (reproduction steps) | long text | yes | prompt: "What did you do, what did you expect, what happened instead?" |
| How much did this affect you? | select | yes | Lost work or data / Had to give up / Found a workaround / Cosmetic |
| Screenshot / log upload | file | no | **explicit consent text:** "Only attach if you're comfortable sharing — screenshots may show your portfolio or chat content." |
| May we contact you about this? | checkbox + email (prefilled if signed in) | no | consent-gated |

## Data-minimization and sensitive-data handling

- The only field that *asks for* personal information is the optional
  contact email. However, **screenshots, logs, and free-text reproduction
  steps may inherently contain sensitive personal or financial data**
  (portfolio contents, chat text) — treat every upload and free-text field
  as **consented sensitive data**, not as anonymous feedback.
- Handling rules for consented sensitive data: access limited to the triage
  owner(s) named in `OWNERSHIP.md`; never quote screenshots/log contents or
  identifying free text into GitHub issues (issues get a paraphrased,
  de-identified repro); on issue closure, delete the original attachment
  from the form provider **and** the triage tracker, and verify no copy
  survived in the issue.
- Never ask for passwords, account balances, or full chat transcripts;
  reproduction steps suffice — we can look up server-side state by account
  with the user's consent.
- Feedback data is not used for marketing; contact consent covers only the
  reported issue.

## Triage loop

1. **Immediate path:** "Blocks me completely" submissions trigger an instant
   notification to the triage owner (form provider email/webhook
   notification on that severity value — configure when creating the form,
   part of the same EXTERNAL setup). They are candidate SEV-2s and follow
   `INCIDENT_SEVERITY.md` acknowledgment targets (2 h), not the weekly
   batch.
2. Weekly: convert remaining submissions to GitHub issues (`beta-feedback` +
   feature-area label), dedupe, map reporter severity → SEV scale where it's
   a defect.
3. Themes roll up into the cohort report (`BETA_TELEMETRY_TEMPLATE.md`
   §Feedback themes).

Status: schema `IMPLEMENTED` (this document); the live form itself is
`EXTERNAL ACCESS REQUIRED` (create + link before Cohort 0 sends any invite).
