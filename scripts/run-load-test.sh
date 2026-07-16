#!/usr/bin/env bash
# Operator entrypoint for tests/load/. Validates every safety precondition
# in bash — before k6 is even invoked — then execs k6. The k6 scripts
# themselves (tests/load/lib/safety.js) re-check everything as defense in
# depth for anyone who runs `k6 run` directly, bypassing this wrapper.
#
# Usage:
#   scripts/run-load-test.sh <a|b|c|d|chat|search|paper-trading> [--dry-run]
#
# This script does not read a .env file for you — export every required
# variable in your shell first, or source one explicitly:
#   set -a; source .env.load-test; set +a; scripts/run-load-test.sh a
#
# It never prints the value of SUPABASE_SERVICE_ROLE_KEY or any auth token.

set -euo pipefail

PROFILE="${1:-}"
DRY_RUN=false
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    DRY_RUN=true
  fi
done

if [[ -z "$PROFILE" || "$PROFILE" == "--dry-run" ]]; then
  cat <<'EOF'
Usage: scripts/run-load-test.sh <profile> [--dry-run]

Profiles:
  a               Test A — Normal browsing (150 users, 30 concurrent, no AI)
  b               Test B — Busy beta period (75 concurrent, 10-20 AI, needs ALLOW_PAID_AI_LOAD)
  c               Test C — Burst (100 arrivals/60s, 30 AI requests/15s, needs ALLOW_PAID_AI_LOAD)
  d               Test D — Soak (default 4h, repeated AI, needs ALLOW_PAID_AI_LOAD)
  chat            Ad-hoc chat load (needs ALLOW_PAID_AI_LOAD)
  search          Ad-hoc search load
  paper-trading   Ad-hoc paper-trading write load (uses service-role key directly)

Test E (failure injection) is never run by this script — see
tests/load/failure-injection/README.md for the operator-controlled procedure.

Add --dry-run to validate configuration and print the full plan without
sending a single request.
EOF
  exit 1
fi

declare -A SCRIPT_MAP=(
  [a]="tests/load/profile-a-normal-browsing.js"
  [b]="tests/load/profile-b-busy-beta.js"
  [c]="tests/load/profile-c-burst.js"
  [d]="tests/load/profile-d-soak.js"
  [chat]="tests/load/chat-load.js"
  [search]="tests/load/search-load.js"
  [paper-trading]="tests/load/paper-trading-load.js"
)

SCRIPT_PATH="${SCRIPT_MAP[$PROFILE]:-}"
if [[ -z "$SCRIPT_PATH" ]]; then
  echo "Unknown profile: $PROFILE" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Bash-level safety gate (mirrors tests/load/lib/safety.js). Refuses to even
# invoke k6 unless every precondition holds, UNLESS --dry-run, in which case
# it collects and prints what's missing instead of exiting non-zero, then
# still never invokes k6.
# ---------------------------------------------------------------------------

FAILURES=()

truthy() {
  case "${1:-}" in
    1|true|TRUE|True|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

if ! truthy "${LOAD_TEST_CONFIRMED:-}"; then
  FAILURES+=("LOAD_TEST_CONFIRMED=true is required.")
fi

if [[ -z "${BACKEND_URL:-}" ]]; then
  FAILURES+=("BACKEND_URL is required.")
elif [[ ! "$BACKEND_URL" =~ ^https://[^/:?#]+ ]]; then
  FAILURES+=("BACKEND_URL must be an https:// URL (got \"$BACKEND_URL\") — refusing malformed, schemeless, or plaintext-http targets since bearer credentials are sent to this host.")
else
  TARGET_HOST="$(echo "$BACKEND_URL" | sed -E 's#^https://##; s#[/:?#].*##' | tr '[:upper:]' '[:lower:]')"
fi

if [[ -z "${LOAD_TEST_ALLOWED_HOSTS:-}" ]]; then
  FAILURES+=("LOAD_TEST_ALLOWED_HOSTS is required (comma-separated). Fails closed.")
elif [[ -n "${TARGET_HOST:-}" ]]; then
  IFS=',' read -ra ALLOWED <<< "$(echo "$LOAD_TEST_ALLOWED_HOSTS" | tr '[:upper:]' '[:lower:]')"
  MATCHED=false
  for host in "${ALLOWED[@]}"; do
    if [[ "$(echo "$host" | xargs)" == "$TARGET_HOST" ]]; then MATCHED=true; fi
  done
  if [[ "$MATCHED" != true ]]; then
    FAILURES+=("Target host \"$TARGET_HOST\" is not in LOAD_TEST_ALLOWED_HOSTS.")
  fi
fi

if [[ -z "${LOAD_TEST_PRODUCTION_HOSTNAMES:-}" ]]; then
  FAILURES+=("LOAD_TEST_PRODUCTION_HOSTNAMES is required (comma-separated known-production hostnames). Fails closed — this repo has no committed source of truth for the production hostname, so you must state it explicitly.")
elif [[ -n "${TARGET_HOST:-}" ]]; then
  IFS=',' read -ra PROD <<< "$(echo "$LOAD_TEST_PRODUCTION_HOSTNAMES" | tr '[:upper:]' '[:lower:]')"
  for host in "${PROD[@]}"; do
    if [[ "$(echo "$host" | xargs)" == "$TARGET_HOST" ]]; then
      FAILURES+=("Target host \"$TARGET_HOST\" is listed in LOAD_TEST_PRODUCTION_HOSTNAMES. Refusing.")
    fi
  done
fi

if ! truthy "${LOAD_TEST_ISOLATED_INFRA_CONFIRMED:-}"; then
  FAILURES+=("LOAD_TEST_ISOLATED_INFRA_CONFIRMED=true is required — confirms the target's Supabase/Redis/AI quota are NOT shared with production. If they ARE shared, do not set this to true and do not run this suite.")
fi

if [[ -z "${K6_AUTH_TOKEN:-}${K6_AUTH_TOKENS:-}${K6_AUTH_TOKENS_JSON:-}" ]]; then
  FAILURES+=("No test-user credentials supplied (K6_AUTH_TOKEN / K6_AUTH_TOKENS / K6_AUTH_TOKENS_JSON).")
fi

if ! truthy "${LOAD_TEST_DEDICATED_USERS_CONFIRMED:-}"; then
  FAILURES+=("LOAD_TEST_DEDICATED_USERS_CONFIRMED=true is required — confirms credentials belong to dedicated test users (see tests/load/setup/manage-test-users.mjs).")
fi

if [[ -z "${LOAD_TEST_MAX_VUS:-}" ]]; then
  FAILURES+=("LOAD_TEST_MAX_VUS is required.")
fi

if [[ -z "${LOAD_TEST_MAX_DURATION_SECONDS:-}" ]]; then
  FAILURES+=("LOAD_TEST_MAX_DURATION_SECONDS is required.")
fi

AI_PROFILES=(b c d chat)
NEEDS_AI=false
for p in "${AI_PROFILES[@]}"; do
  if [[ "$PROFILE" == "$p" ]]; then NEEDS_AI=true; fi
done
if [[ "$NEEDS_AI" == true ]] && ! truthy "${ALLOW_PAID_AI_LOAD:-}"; then
  FAILURES+=("Profile '$PROFILE' issues paid AI requests. ALLOW_PAID_AI_LOAD=true is required.")
fi

if [[ -z "${LOAD_TEST_RUN_ID:-}" ]]; then
  FAILURES+=("LOAD_TEST_RUN_ID is required. Generate one with: export LOAD_TEST_RUN_ID=\$(date -u +%Y%m%dT%H%M%SZ)-\$\$")
fi

# ---------------------------------------------------------------------------
# Dry run: print the plan, never invoke k6, exit 0 regardless of failures
# found above (that's the point — show what's missing).
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" == true ]]; then
  echo "=== DRY RUN — scripts/run-load-test.sh will NOT invoke k6 ==="
  echo "Profile:              $PROFILE ($SCRIPT_PATH)"
  echo "Target environment:   ${BACKEND_URL:-<unset>}"
  echo "Max VUs configured:   ${LOAD_TEST_MAX_VUS:-<unset>}"
  echo "Max duration:         ${LOAD_TEST_MAX_DURATION_SECONDS:-<unset>}s"
  echo "AI requests involved: $NEEDS_AI"
  echo "Failure injection:    false (this wrapper never runs Test E — see tests/load/failure-injection/)"
  echo ""
  echo "Required environment variables and their current status:"
  for var in LOAD_TEST_CONFIRMED BACKEND_URL LOAD_TEST_ALLOWED_HOSTS LOAD_TEST_PRODUCTION_HOSTNAMES \
             LOAD_TEST_ISOLATED_INFRA_CONFIRMED LOAD_TEST_DEDICATED_USERS_CONFIRMED LOAD_TEST_MAX_VUS \
             LOAD_TEST_MAX_DURATION_SECONDS LOAD_TEST_RUN_ID; do
    if [[ -n "${!var:-}" ]]; then
      echo "  [set]     $var"
    else
      echo "  [MISSING] $var"
    fi
  done
  if [[ "$NEEDS_AI" == true ]]; then
    if truthy "${ALLOW_PAID_AI_LOAD:-}"; then echo "  [set]     ALLOW_PAID_AI_LOAD"; else echo "  [MISSING] ALLOW_PAID_AI_LOAD"; fi
  fi
  if [[ -n "${K6_AUTH_TOKEN:-}${K6_AUTH_TOKENS:-}${K6_AUTH_TOKENS_JSON:-}" ]]; then
    echo "  [set]     K6_AUTH_TOKEN(S) (value not printed)"
  else
    echo "  [MISSING] K6_AUTH_TOKEN(S)"
  fi
  echo ""
  if [[ ${#FAILURES[@]} -eq 0 ]]; then
    echo "All bash-level safety checks would PASS — this profile is ready to run for real (drop --dry-run)."
  else
    echo "This profile would currently be REFUSED for a real run:"
    for f in "${FAILURES[@]}"; do echo "  - $f"; done
  fi
  echo ""
  if command -v k6 >/dev/null 2>&1; then
    echo "Invoking k6 with DRY_RUN=true now to print its own (more detailed, per-request-volume) plan:"
    echo "---"
    DRY_RUN=true k6 run "$SCRIPT_PATH" || true
  else
    echo "k6 is not installed on this machine — skipping the k6-level dry-run plan"
    echo "(target/max-users/max-duration/AI-budget/request-volume detail printed by the script itself)."
    echo "Install k6 (https://k6.io/docs/get-started/installation/) to see that output."
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# Real run: refuse outright on any failure.
# ---------------------------------------------------------------------------
if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo "Refusing to run — safety checks failed:" >&2
  for f in "${FAILURES[@]}"; do echo "  - $f" >&2; done
  echo "" >&2
  echo "Run with --dry-run to see the full plan without these being fatal." >&2
  exit 1
fi

echo "Running $PROFILE against $BACKEND_URL (run ID: $LOAD_TEST_RUN_ID)..."
exec k6 run "$SCRIPT_PATH"
