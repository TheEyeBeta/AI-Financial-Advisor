# Manual Assistive-Technology Test Scripts

**Owner:** TheEyeBeta · **Created:** 2026-07-16 (Phase 8)
**Execution status: NOT VERIFIED — no run of any script below has been
recorded yet.** Log results in the table at the bottom. A script counts as
**verified** only when its row has ALL of: `Result = pass`, a date and named
tester, exact AT/browser/OS versions, and a real build SHA (non-empty, not
`unknown`, and matching the release under evaluation). A row with a `fail`
result, missing versions, or a placeholder SHA is a *record*, not a pass —
the staged-launch gates (`docs/readiness/STAGED_LAUNCH.md` §3) require
passing entries by this definition, not merely logged rows.

Automated coverage context: axe scans + keyboard/zoom assertions run in CI
(`e2e/a11y.spec.ts`, gates listed in `BETA_SUPPORT_MATRIX.md`). These scripts
cover what automation cannot: actual screen-reader announcement quality.

## Configurations

| ID | AT + browser | Platform | Priority |
| --- | --- | --- | --- |
| SR-1 | NVDA + Chrome | Windows 11 | Blocking before Cohort 1 |
| SR-2 | VoiceOver + Safari | macOS | Blocking before Cohort 1 |
| SR-3 | TalkBack + Chrome | Android | Blocking before Cohort 2 |
| SR-4 | JAWS + Chrome | Windows 11 | Optional (run if licence available) |

The table above names the tool pairing only — "latest" is a moving target,
so **each run must record the exact AT version, browser version, and OS
version** in the results table; a result without versions is not
reproducible evidence.

Common setup: staging URL, fresh test account per run (`sr-test+<date>@…`),
release SHA recorded from the page's `release-sha` meta tag.

## Script A — Landing, sign-up and sign-in (all configs)

1. Load the landing page. **Expect:** page title announced ("Lens — AI
   Financial Advisor"); heading level 1 "Lens" reachable via heading
   navigation (NVDA `H` / VO rotor / TalkBack headings).
2. Navigate by landmarks. **Expect:** at minimum a main region and footer
   navigation are announced; no unlabeled landmark soup.
3. Move to "Create Account" and "Sign In" buttons. **Expect:** each announces
   role "button" + its visible name; icons are not read as unlabeled images.
4. Activate "Sign In". **Expect:** dialog announced with its name ("Sign in")
   and description ("Welcome back to Lens"); focus lands inside the dialog;
   AT enters the dialog context.
5. Traverse the form. **Expect:** "Email" and "Password" announce label +
   role + required state; typing echoes per AT verbosity settings.
6. Submit empty form. **Expect:** error feedback is announced (toast/status
   region), not silence.
7. Press Escape. **Expect:** dialog closes; focus returns to the "Sign In"
   button and the AT announces it (regression anchor for the 2026-07-16
   dialog focus-restoration fix).
8. Repeat 4–7 for "Create Account". **Expect:** same standards; password
   requirements are announced, not visual-only.

## Script B — Onboarding (SR-1, SR-2)

1. Sign in with an un-onboarded account. **Expect:** navigation to
   onboarding is announced (page/heading change perceivable).
2. Step through all five steps using only AT navigation + keyboard.
   **Expect:** each step's heading and progress indication are announced;
   radio groups/selects announce group label, option name, and position;
   "Next"/"Back" buttons are reachable and named.
3. Refresh mid-flow. **Expect:** resumed step is identifiable by heading
   announcement without sighted context.
4. Complete final step. **Expect:** transition to the advisor is announced;
   no focus black hole.

## Script C — IRIS chat (SR-1, SR-2, SR-3)

1. Open /advisor. **Expect:** composer input announces a meaningful label
   (not "edit text" alone); send button named.
2. Send "What is an index fund?". **Expect:** the pending/streaming state is
   perceivable (busy indication or live-region updates); the completed
   response is readable in order via virtual cursor/rotor; code of conduct:
   response must NOT be announced token-by-token as an unusable firehose —
   note actual behaviour verbatim.
3. Trigger a failure (airplane-mode/network toggle). **Expect:** the error
   banner is announced via a live region, not silent.
4. Reload and re-open the conversation. **Expect:** message history is
   navigable; user vs IRIS messages are distinguishable by announcement.

## Script D — Paper trading (SR-1, SR-2)

1. Open paper trading; navigate to the trade form. **Expect:** symbol,
   quantity and side controls announce labels and current values.
2. Submit an invalid quantity (0). **Expect:** the validation error is
   announced and programmatically associated (re-query the field: its
   error/description is read with it).
3. Execute a small valid buy, then close it. **Expect:** confirmation state
   changes are announced; positions table is navigable with row/column
   headers announced (table navigation commands).

## Script E — Academy (SR-3 primarily, spot-check others)

1. Open Academy → a tier → a lesson. **Expect:** card/links announce
   destination names; lesson content is heading-structured.
2. Take the quiz. **Expect:** each question announces as a labelled group;
   answer state (selected/correct/incorrect) is perceivable non-visually;
   score summary announced on completion.

## Recording results

| Date | Config | AT / browser / OS versions | Script | Build SHA | Tester | Result (pass / fail + issues filed) |
| --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | *no runs recorded yet — status NOT VERIFIED* |

File issues with label `a11y` + severity per
`docs/readiness/INCIDENT_SEVERITY.md` analogues (blocking = SEV-2-equivalent
for launch gating; see STAGED_LAUNCH cohort criteria).
