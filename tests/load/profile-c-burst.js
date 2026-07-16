// Test C — Burst (readiness spec).
// 100 users arriving within 60 seconds; 30 AI requests initiated within
// 15 seconds (as a concurrent, separate burst scenario).
//
// AI-backed — requires ALLOW_PAID_AI_LOAD=true (real provider spend).
// Run via: scripts/run-load-test.sh c
// Dry run: DRY_RUN=true scripts/run-load-test.sh c

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import {
  dryRunOptions,
  durationToSeconds,
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

const HOLD_DURATION = __ENV.LOAD_TEST_DURATION || "3m";
const holdSeconds = durationToSeconds(HOLD_DURATION);
enforceMaxDuration(
  {
    "burst arrival_burst (60s ramp + hold + 30s ramp-down)":
      holdSeconds === null ? HOLD_DURATION : `${60 + holdSeconds + 30}s`,
    "burst ai_burst maxDuration": "15s",
  },
  safety.maxDurationSeconds,
);

const burstFailures = new Rate("burst_failures");
const chatFirstTokenMs = new Trend("chat_first_token_ms");
const chatCompletionMs = new Trend("chat_completion_ms");
const chatFailures = new Rate("chat_failures");
const status5xx = new Counter("http_status_5xx");
const status429 = new Counter("http_status_429");

// ai_burst's VUs are reserved first so the two concurrently-running
// scenarios never together exceed LOAD_TEST_MAX_VUS.
const aiBurstVUs = Math.min(30, safety.maxVUs);
const burstVUs = Math.min(100, Math.max(1, safety.maxVUs - aiBurstVUs));

function dryRunPlan() {
  printDryRunPlan({
    target_environment: safety.targetHost,
    test_profile: "Test C — Burst",
    max_users: `${burstVUs} arriving over 60s + ${aiBurstVUs} AI burst VUs = ${burstVUs + aiBurstVUs} total (requested) / ${safety.maxVUs} (LOAD_TEST_MAX_VUS)`,
    max_duration: `60s ramp + ${HOLD_DURATION} hold + 30s ramp-down`,
    ai_request_budget: "30 AI requests within 15 seconds (paid — ALLOW_PAID_AI_LOAD required)",
    expected_request_volume: `arrival burst: ~2 requests per VU per iteration; AI burst: exactly 30 requests total`,
    required_env_vars:
      "LOAD_TEST_CONFIRMED, LOAD_TEST_ALLOWED_HOSTS, LOAD_TEST_PRODUCTION_HOSTNAMES, " +
      "LOAD_TEST_ISOLATED_INFRA_CONFIRMED, K6_AUTH_TOKEN(S), LOAD_TEST_DEDICATED_USERS_CONFIRMED, " +
      "LOAD_TEST_MAX_VUS, LOAD_TEST_MAX_DURATION_SECONDS, ALLOW_PAID_AI_LOAD, LOAD_TEST_RUN_ID, " +
      "SUPABASE_URL, SUPABASE_ANON_KEY",
    destructive_or_failure_injection: false,
    safety_check_failures: safety.failures.length > 0 ? safety.failures : "none — all checks would pass",
  });
}

export const options = isDryRun()
  ? dryRunOptions("arrivalBurst")
  : {
      scenarios: {
        arrival_burst: {
          executor: "ramping-vus",
          exec: "arrivalBurst",
          startVUs: 0,
          stages: [
            { duration: "60s", target: burstVUs }, // 100 users arrive within 60s
            { duration: HOLD_DURATION, target: burstVUs }, // hold
            { duration: "30s", target: 0 },
          ],
          gracefulRampDown: "15s",
        },
        ai_burst: {
          executor: "shared-iterations",
          exec: "aiBurst",
          vus: aiBurstVUs,
          iterations: 30, // 30 AI requests
          maxDuration: "15s", // initiated within 15 seconds
        },
      },
      thresholds: {
        burst_failures: ["rate<0.01"],
        // docs/SLO.md #5 — still expect first-token p95 under budget even under burst
        chat_first_token_ms: ["p(95)<8000"],
        chat_failures: ["rate<0.01"],
      },
    };

export function arrivalBurst() {
  if (isDryRun()) {
    dryRunPlan();
    return;
  }

  const baseUrl = backendUrl();
  const sbUrl = supabaseUrl();
  const token = pickAuthToken();
  if (!token) throw new Error("Missing auth token for burst traffic");

  const sbHeaders = supabaseRestHeaders(__ENV.SUPABASE_ANON_KEY, "core", {
    Authorization: `Bearer ${token}`,
    ...loadTestHeaders(safety.runId),
  });

  const responses = group("burst_browse", () => [
    http.get(`${sbUrl}/rest/v1/users?select=id&limit=1`, {
      headers: sbHeaders,
      tags: { scenario: "burst_profile" },
    }),
    http.get(`${baseUrl}/api/stocks/ranking?limit=10`, {
      headers: loadTestHeaders(safety.runId, jsonHeaders({ Authorization: `Bearer ${token}` })),
      tags: { scenario: "burst_ranking" },
    }),
  ]);

  let anyFailure = false;
  for (const response of responses) {
    if (response.status >= 500) status5xx.add(1);
    if (isFailureResponse(response)) anyFailure = true;
    check(response, { "burst request did not 5xx": () => !isFailureResponse(response) });
  }
  burstFailures.add(anyFailure ? 1 : 0);

  sleep(shortSleep(0.5));
}

export function aiBurst() {
  if (isDryRun()) {
    return;
  }

  const baseUrl = backendUrl();
  const token = pickAuthToken();
  if (!token) throw new Error("Missing auth token for AI burst");

  const message = __ENV.K6_CHAT_MESSAGE || "Explain dollar-cost averaging in two sentences.";

  const response = group("chat_burst", () =>
    http.post(
      `${baseUrl}/api/chat`,
      JSON.stringify({
        message,
        max_tokens: 64,
        experience_level: getFirstNonEmptyEnv("K6_EXPERIENCE_LEVEL", "beginner"),
      }),
      {
        headers: jsonHeaders(loadTestHeaders(safety.runId, { Authorization: `Bearer ${token}` })),
        tags: { scenario: "ai_chat_burst" },
      },
    ),
  );

  if (isRateLimited(response)) status429.add(1);
  if (response.status >= 500) status5xx.add(1);

  const cleanTermination = response.status === 200 || response.status === 429 || response.status === 503;
  chatFailures.add(cleanTermination ? 0 : 1);
  chatFirstTokenMs.add(response.timings.waiting);
  chatCompletionMs.add(response.timings.duration);

  check(response, { "burst chat terminated cleanly (200/429/503)": () => cleanTermination });
}

export const handleSummary = buildHandleSummary({ profile: "test-c-burst", includesAi: true });
