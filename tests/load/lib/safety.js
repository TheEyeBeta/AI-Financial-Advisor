// Safety gate for every k6 script in this suite. Import and call
// `enforceSafety()` at module load time (top-level, not inside a function) —
// k6 evaluates the init context once per VU before any scenario runs, so a
// thrown error here aborts the run before a single request is sent.
//
// This is defense in depth: `scripts/run-load-test.sh` is the primary
// operator entrypoint and performs the same checks in bash before it will
// even invoke `k6 run`. This module exists so that a `k6 run` invoked
// directly (bypassing the wrapper) is still refused.

function truthy(value) {
  return ["1", "true", "yes", "on"].includes((value || "").trim().toLowerCase());
}

// https:// only — every request here carries a bearer token or the
// service-role key, and an http:// target would send those in plaintext.
function parseHostname(url) {
  const match = /^https:\/\/([^/:?#]+)/.exec((url || "").trim());
  return match ? match[1].toLowerCase() : "";
}

export function durationToSeconds(value) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec((value || "").trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const multiplier = { ms: 0.001, s: 1, m: 60, h: 3600 }[match[2]];
  return amount * multiplier;
}

function parseList(raw) {
  return (raw || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @param {object} options
 * @param {boolean} [options.requiresAi] - this scenario calls a paid AI provider
 * @param {boolean} [options.requiresFailureInjection] - this scenario induces a failure
 * @param {boolean} [options.requiresSupabase] - this scenario also talks to Supabase directly
 *   (REST reads with the anon key, or writes with the service-role key) — its host must be
 *   validated too, not just BACKEND_URL, or a misconfigured SUPABASE_URL bypasses the safety net.
 * @returns {{ runId: string, targetHost: string, maxVUs: number, maxDurationSeconds: number }}
 */
export function enforceSafety({
  requiresAi = false,
  requiresFailureInjection = false,
  requiresSupabase = false,
} = {}) {
  const failures = [];

  if (!truthy(__ENV.LOAD_TEST_CONFIRMED)) {
    failures.push(
      "LOAD_TEST_CONFIRMED=true is required. This is a deliberate, explicit confirmation that " +
        "an operator reviewed the target and profile before generating load — it must be set by hand, " +
        "never defaulted or scripted around.",
    );
  }

  const allowedHosts = parseList(__ENV.LOAD_TEST_ALLOWED_HOSTS);
  if (allowedHosts.length === 0) {
    failures.push(
      "LOAD_TEST_ALLOWED_HOSTS is required (comma-separated hostnames). Fails closed: an empty " +
        "allowlist refuses every target, it does not mean 'allow everything'.",
    );
  }

  const productionHosts = parseList(__ENV.LOAD_TEST_PRODUCTION_HOSTNAMES);
  if (productionHosts.length === 0) {
    failures.push(
      "LOAD_TEST_PRODUCTION_HOSTNAMES is required (comma-separated hostnames of the real production " +
        "frontend and backend). This repo has no committed source of truth for the production hostname " +
        "— you must state it explicitly so this check has something to compare against. Fails closed.",
    );
  }

  function checkTarget(envVarName, rawUrl, label) {
    const targetHost = parseHostname(rawUrl);
    if (!targetHost) {
      failures.push(`${envVarName} must be set to a valid https:// URL.`);
      return "";
    }
    if (allowedHosts.length > 0 && !allowedHosts.includes(targetHost)) {
      failures.push(
        `${label} host "${targetHost}" is not in LOAD_TEST_ALLOWED_HOSTS (${allowedHosts.join(", ")}).`,
      );
    }
    if (productionHosts.length > 0 && productionHosts.includes(targetHost)) {
      failures.push(
        `${label} host "${targetHost}" is listed in LOAD_TEST_PRODUCTION_HOSTNAMES. Refusing to run — ` +
          "load tests must never target production.",
      );
    }
    return targetHost;
  }

  const backendUrl = (__ENV.BACKEND_URL || "").trim();
  const targetHost = checkTarget("BACKEND_URL", backendUrl, "Backend");

  if (requiresSupabase) {
    const supabaseUrl = (__ENV.SUPABASE_URL || "").trim();
    checkTarget("SUPABASE_URL", supabaseUrl, "Supabase");
  }

  if (!truthy(__ENV.LOAD_TEST_ISOLATED_INFRA_CONFIRMED)) {
    failures.push(
      "LOAD_TEST_ISOLATED_INFRA_CONFIRMED=true is required — explicit operator confirmation that the " +
        "target's Supabase project, Redis instance, and AI provider quota are dedicated to this staging " +
        "environment and not shared with production. If they ARE shared, this variable must not be set " +
        "to true, and this suite must not be run (Tests B/C/D generate real load against real data).",
    );
  }

  if (!(__ENV.K6_AUTH_TOKEN || __ENV.K6_AUTH_TOKENS || __ENV.K6_AUTH_TOKENS_JSON)) {
    failures.push(
      "No test-user credentials supplied (K6_AUTH_TOKEN / K6_AUTH_TOKENS / K6_AUTH_TOKENS_JSON).",
    );
  }
  if (!truthy(__ENV.LOAD_TEST_DEDICATED_USERS_CONFIRMED)) {
    failures.push(
      "LOAD_TEST_DEDICATED_USERS_CONFIRMED=true is required — confirms the supplied credentials belong " +
        "to dedicated test users (see tests/load/setup/manage-test-users.mjs), not real production accounts.",
    );
  }

  const maxVUsRaw = __ENV.LOAD_TEST_MAX_VUS;
  const maxVUs = Number(maxVUsRaw);
  if (!maxVUsRaw || !Number.isFinite(maxVUs) || maxVUs <= 0) {
    failures.push("LOAD_TEST_MAX_VUS must be set to a positive integer.");
  }

  const maxDurationRaw = __ENV.LOAD_TEST_MAX_DURATION_SECONDS;
  const maxDurationSeconds = Number(maxDurationRaw);
  if (!maxDurationRaw || !Number.isFinite(maxDurationSeconds) || maxDurationSeconds <= 0) {
    failures.push("LOAD_TEST_MAX_DURATION_SECONDS must be set to a positive integer.");
  }

  if (requiresAi && !truthy(__ENV.ALLOW_PAID_AI_LOAD)) {
    failures.push(
      "This profile issues AI-provider-backed requests, which cost real money. " +
        "ALLOW_PAID_AI_LOAD=true is required.",
    );
  }

  if (requiresFailureInjection && !truthy(__ENV.ALLOW_FAILURE_INJECTION)) {
    failures.push(
      "This profile induces a dependency failure. ALLOW_FAILURE_INJECTION=true is required.",
    );
  }

  const runId = (__ENV.LOAD_TEST_RUN_ID || "").trim();
  if (!runId) {
    failures.push(
      "LOAD_TEST_RUN_ID is required — a unique identifier attached to every request this run makes, " +
        "so its effects (and any test data it creates) can be found and cleaned up afterward. " +
        "Generate one with: LOAD_TEST_RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)-$$",
    );
  }

  const result = {
    runId: runId || "(unset)",
    targetHost: targetHost || "(unset)",
    maxVUs: Number.isFinite(maxVUs) && maxVUs > 0 ? maxVUs : 0,
    maxDurationSeconds: Number.isFinite(maxDurationSeconds) && maxDurationSeconds > 0 ? maxDurationSeconds : 0,
    requiresAi,
    requiresFailureInjection,
    failures,
  };

  if (failures.length === 0) return result;

  // Dry-run mode must describe what's missing, not crash on it — that's the
  // entire point of "validation mode." Only a real run refuses outright.
  if (isDryRun()) return result;

  const message = [
    "Refusing to run — safety checks failed:",
    ...failures.map((f, i) => `  ${i + 1}. ${f}`),
    "",
    "Run with DRY_RUN=true (or use scripts/run-load-test.sh --dry-run) to see the full " +
      "configuration this script expects without generating any load.",
  ].join("\n");
  throw new Error(message);
}

/**
 * Validates one or more requested scenario durations against
 * LOAD_TEST_MAX_DURATION_SECONDS. LOAD_TEST_MAX_DURATION_SECONDS is
 * documented as a hard cap — this is what actually enforces that, since
 * enforceSafety() only checks that the env var itself is a positive number,
 * not that any given profile's requested duration stays under it.
 *
 * @param {Record<string, string>} requestedDurations - label -> k6 duration string (e.g. "10m", "4h")
 * @param {number} maxDurationSeconds - from enforceSafety()'s result
 * @returns {string[]} failure messages (empty if all durations are within the cap)
 */
export function checkMaxDuration(requestedDurations, maxDurationSeconds) {
  const failures = [];
  for (const [label, value] of Object.entries(requestedDurations)) {
    const seconds = durationToSeconds(value);
    if (seconds === null) {
      failures.push(`${label} duration "${value}" is not a valid k6 duration (e.g. "4h", "30m").`);
      continue;
    }
    if (seconds > maxDurationSeconds) {
      failures.push(
        `${label} duration (${value} = ${seconds}s) exceeds LOAD_TEST_MAX_DURATION_SECONDS ` +
          `(${maxDurationSeconds}s). Raise the max explicitly if this is intended.`,
      );
    }
  }
  return failures;
}

/**
 * Runs checkMaxDuration() and throws (or, in dry-run mode, returns the
 * failures instead of throwing) — the same dry-run-tolerant pattern as
 * enforceSafety().
 */
export function enforceMaxDuration(requestedDurations, maxDurationSeconds) {
  const failures = checkMaxDuration(requestedDurations, maxDurationSeconds);
  if (failures.length === 0 || isDryRun()) return failures;
  throw new Error(
    ["Refusing to run — duration checks failed:", ...failures.map((f, i) => `  ${i + 1}. ${f}`)].join("\n"),
  );
}

/** Headers every request in a load test should carry, for traceability. */
export function loadTestHeaders(runId, extra = {}) {
  return Object.assign(
    {
      "X-Load-Test-Run-Id": runId,
      "X-Load-Test": "true",
    },
    extra,
  );
}

export function isDryRun() {
  return truthy(__ENV.DRY_RUN);
}

/**
 * A minimal, always-valid k6 options object for dry-run mode: one VU, one
 * iteration, executing `execName` (default: the script's `default` export).
 * The named function itself is responsible for checking isDryRun() and
 * printing the plan instead of sending real requests — this only ensures
 * k6 has something well-formed to execute instead of zero scenarios, which
 * k6 rejects.
 */
export function dryRunOptions(execName) {
  const scenario = { executor: "shared-iterations", vus: 1, iterations: 1, maxDuration: "10s" };
  if (execName) scenario.exec = execName;
  return { scenarios: { dry_run: scenario }, thresholds: {} };
}

/** Print the full run plan and return without sending any requests. Call
 * this as the first line of every exec function, before any HTTP call. */
export function printDryRunPlan(plan) {
  console.log("\n=== DRY RUN — no requests will be sent ===");
  for (const [key, value] of Object.entries(plan)) {
    console.log(`${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
  }
  console.log("=== END DRY RUN ===\n");
}
