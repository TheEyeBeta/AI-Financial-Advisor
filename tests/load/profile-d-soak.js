// Test D — Soak (readiness spec).
// Configurable duration, defaulting to 4 hours. Normal user traffic plus
// repeated AI calls. Scheduled jobs are NOT controlled by this script —
// the target environment's scheduler (SCHEDULER_ENABLED=true replica) must
// already be running for "scheduled jobs active" to be true during the soak;
// this script only generates the user-traffic side.
//
// AI-backed — requires ALLOW_PAID_AI_LOAD=true (real, sustained provider spend
// over hours — review the AI request budget in --dry-run before running this).
// Run via: LOAD_TEST_DURATION=4h scripts/run-load-test.sh d
// Dry run: DRY_RUN=true scripts/run-load-test.sh d

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import {
  dryRunOptions,
  enforceMaxDuration,
  enforceSafety,
  isDryRun,
  loadTestHeaders,
  printDryRunPlan,
} from "./lib/safety.js";
import { buildHandleSummary } from "./lib/reporting.js";
import {
  backendUrl,
  getFirstNonEmptyEnv,
  isFailureResponse,
  isRateLimited,
  jsonHeaders,
  pickAuthToken,
  shortSleep,
  supabaseRestHeaders,
  supabaseUrl,
} from "./helpers.js";

const safety = enforceSafety({ requiresAi: true, requiresSupabase: true });

const DEFAULT_DURATION = "4h";
const requestedDuration = __ENV.LOAD_TEST_DURATION || DEFAULT_DURATION;
const durationFailures = enforceMaxDuration({ "soak duration": requestedDuration }, safety.maxDurationSeconds);
const durationError = durationFailures.length > 0 ? durationFailures.join(" ") : null;

const soakFailures = new Rate("soak_failures");
const chatFirstTokenMs = new Trend("chat_first_token_ms");
const chatCompletionMs = new Trend("chat_completion_ms");
const chatFailures = new Rate("chat_failures");
const status5xx = new Counter("http_status_5xx");

// aiVUs is reserved first so the two concurrently-running scenarios never
// together exceed the configured LOAD_TEST_MAX_VUS cap.
const totalVUs = Math.min(Number(__ENV.K6_SOAK_VUS || 20), safety.maxVUs);
const aiVUs = Math.max(1, Math.min(5, totalVUs - 1, totalVUs));
const mixedVUs = Math.max(1, totalVUs - aiVUs);

function dryRunPlan() {
  printDryRunPlan({
    target_environment: safety.targetHost,
    test_profile: "Test D — Soak",
    max_users: `${mixedVUs} mixed + ${aiVUs} AI = ${totalVUs} total (requested) / ${safety.maxVUs} (LOAD_TEST_MAX_VUS)`,
    max_duration: `${requestedDuration} (default 4h) / max ${safety.maxDurationSeconds}s (LOAD_TEST_MAX_DURATION_SECONDS)`,
    ai_request_budget: `${aiVUs} AI VUs, ~1 request per VU per ~30s iteration for the full duration (paid — ALLOW_PAID_AI_LOAD required)`,
    expected_request_volume: `sustained over ${requestedDuration} — this is the profile most likely to exceed a naive request-volume estimate; review LOAD_TEST_MAX_DURATION_SECONDS carefully`,
    required_env_vars:
      "LOAD_TEST_CONFIRMED, LOAD_TEST_ALLOWED_HOSTS, LOAD_TEST_PRODUCTION_HOSTNAMES, " +
      "LOAD_TEST_ISOLATED_INFRA_CONFIRMED, K6_AUTH_TOKEN(S), LOAD_TEST_DEDICATED_USERS_CONFIRMED, " +
      "LOAD_TEST_MAX_VUS, LOAD_TEST_MAX_DURATION_SECONDS, ALLOW_PAID_AI_LOAD, LOAD_TEST_RUN_ID, " +
      "SUPABASE_URL, SUPABASE_ANON_KEY",
    destructive_or_failure_injection: false,
    duration_validation_error: durationError || "none",
    safety_check_failures: safety.failures.length > 0 ? safety.failures : "none — all checks would pass",
  });
}

export const options = isDryRun()
  ? dryRunOptions("soakTraffic")
  : {
      scenarios: {
        soak_traffic: {
          executor: "constant-vus",
          vus: mixedVUs,
          duration: requestedDuration,
          exec: "soakTraffic",
          gracefulStop: "1m",
        },
        soak_ai: {
          executor: "constant-vus",
          vus: aiVUs,
          duration: requestedDuration,
          exec: "soakAi",
          gracefulStop: "1m",
        },
      },
      thresholds: {
        http_req_duration: ["p(95)<500", "p(99)<1500"],
        soak_failures: ["rate<0.005"],
        chat_first_token_ms: ["p(95)<8000"],
        chat_failures: ["rate<0.005"],
      },
    };

export function soakTraffic() {
  if (isDryRun()) {
    dryRunPlan();
    return;
  }

  const baseUrl = backendUrl();
  const sbUrl = supabaseUrl();
  const token = pickAuthToken();
  if (!token) throw new Error("Missing auth token for soak traffic");

  const sbHeaders = supabaseRestHeaders(__ENV.SUPABASE_ANON_KEY, "trading", {
    Authorization: `Bearer ${token}`,
    ...loadTestHeaders(safety.runId),
  });

  const responses = group("soak_browse", () => [
    http.get(`${sbUrl}/rest/v1/open_positions?select=id,symbol&limit=20`, {
      headers: sbHeaders,
      tags: { scenario: "soak_positions" },
    }),
    http.get(`${baseUrl}/api/stocks/ranking?limit=20`, {
      headers: loadTestHeaders(safety.runId, jsonHeaders({ Authorization: `Bearer ${token}` })),
      tags: { scenario: "soak_ranking" },
    }),
  ]);

  let anyFailure = false;
  for (const response of responses) {
    if (response.status >= 500) status5xx.add(1);
    if (isFailureResponse(response)) anyFailure = true;
    check(response, { "soak request did not 5xx": () => !isFailureResponse(response) });
  }
  soakFailures.add(anyFailure ? 1 : 0);

  sleep(shortSleep(3));
}

export function soakAi() {
  if (isDryRun()) {
    return;
  }

  const baseUrl = backendUrl();
  const token = pickAuthToken();
  if (!token) throw new Error("Missing auth token for soak AI traffic");

  const message = __ENV.K6_CHAT_MESSAGE || "Summarize the risks of over-concentration in one sector.";

  const response = group("soak_chat", () =>
    http.post(
      `${baseUrl}/api/chat`,
      JSON.stringify({
        message,
        max_tokens: 96,
        experience_level: getFirstNonEmptyEnv("K6_EXPERIENCE_LEVEL", "beginner"),
      }),
      {
        headers: jsonHeaders(loadTestHeaders(safety.runId, { Authorization: `Bearer ${token}` })),
        tags: { scenario: "soak_ai_chat" },
      },
    ),
  );

  if (response.status >= 500) status5xx.add(1);
  const cleanTermination = response.status === 200 || response.status === 429 || response.status === 503;
  chatFailures.add(cleanTermination ? 0 : 1);
  chatFirstTokenMs.add(response.timings.waiting);
  chatCompletionMs.add(response.timings.duration);

  check(response, { "soak chat terminated cleanly (200/429/503)": () => cleanTermination });

  // Repeated but spaced out — a soak stresses sustained load, not a chat spam burst.
  sleep(shortSleep(30));
}

export const handleSummary = buildHandleSummary({ profile: "test-d-soak", includesAi: true });
