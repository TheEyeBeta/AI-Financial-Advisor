// Test B — Busy beta period (readiness spec).
// 150 registered test users, 75 concurrent: ~55-65 on mixed normal API
// traffic, 10-20 concurrently issuing AI chat requests.
//
// AI-backed — requires ALLOW_PAID_AI_LOAD=true (real provider spend).
// Run via: scripts/run-load-test.sh b
// Dry run: DRY_RUN=true scripts/run-load-test.sh b

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { dryRunOptions, enforceSafety, isDryRun, loadTestHeaders, printDryRunPlan } from "./lib/safety.js";
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

const safety = enforceSafety({ requiresAi: true });

const mixedFailures = new Rate("mixed_failures");
const chatFirstTokenMs = new Trend("chat_first_token_ms");
const chatCompletionMs = new Trend("chat_completion_ms");
const chatFailures = new Rate("chat_failures");
const chatRateLimited = new Counter("chat_rate_limited");
const status5xx = new Counter("http_status_5xx");
const status429 = new Counter("http_status_429");

const aiVUs = Math.max(1, Math.min(20, Number(__ENV.K6_AI_CONCURRENCY || 15)));
const totalVUs = Math.min(75, safety.maxVUs);
const mixedVUs = Math.max(1, totalVUs - aiVUs);

function dryRunPlan() {
  printDryRunPlan({
    target_environment: safety.targetHost,
    test_profile: "Test B — Busy beta period",
    max_users: `${mixedVUs} mixed + ${aiVUs} AI = ${mixedVUs + aiVUs} total (requested) / ${safety.maxVUs} (LOAD_TEST_MAX_VUS)`,
    max_duration: __ENV.LOAD_TEST_DURATION || "10m",
    ai_request_budget: `${aiVUs} concurrent AI VUs, ~1 request per VU per ~2s iteration cycle (paid — ALLOW_PAID_AI_LOAD required)`,
    expected_request_volume: `mixed: ~3 requests per VU per iteration; AI: ~1 request per AI VU per iteration`,
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
  ? dryRunOptions("mixedTraffic")
  : {
      scenarios: {
        mixed_traffic: {
          executor: "constant-vus",
          vus: mixedVUs,
          duration: __ENV.LOAD_TEST_DURATION || "10m",
          exec: "mixedTraffic",
          gracefulStop: "30s",
        },
        ai_traffic: {
          executor: "constant-vus",
          vus: aiVUs,
          duration: __ENV.LOAD_TEST_DURATION || "10m",
          exec: "aiTraffic",
          gracefulStop: "30s",
        },
      },
      thresholds: {
        // docs/SLO.md #2/#3
        "http_req_duration{scenario:mixed_traffic}": ["p(95)<500", "p(99)<1500"],
        mixed_failures: ["rate<0.005"],
        // docs/SLO.md #5 — AI first-token p95 < 8s
        chat_first_token_ms: ["p(95)<8000"],
        // docs/SLO.md #4 — 99.5% clean accept/reject (chat_failures counts unclean only)
        chat_failures: ["rate<0.005"],
      },
    };

export function mixedTraffic() {
  if (isDryRun()) {
    dryRunPlan();
    return;
  }

  const baseUrl = backendUrl();
  const sbUrl = supabaseUrl();
  const token = pickAuthToken();
  if (!token) throw new Error("Missing auth token for mixed traffic");

  const sbHeaders = supabaseRestHeaders(__ENV.SUPABASE_ANON_KEY, "trading", {
    Authorization: `Bearer ${token}`,
    ...loadTestHeaders(safety.runId),
  });

  const responses = group("mixed", () => [
    http.get(`${sbUrl}/rest/v1/open_positions?select=id,symbol&limit=20`, {
      headers: sbHeaders,
      tags: { scenario: "mixed_positions" },
    }),
    http.get(`${baseUrl}/api/stocks/ranking?limit=20`, {
      headers: jsonHeaders({ Authorization: `Bearer ${token}` }),
      tags: { scenario: "mixed_ranking" },
    }),
    http.get(`${baseUrl}/api/news?limit=10`, {
      headers: jsonHeaders({ Authorization: `Bearer ${token}` }),
      tags: { scenario: "mixed_news" },
    }),
  ]);

  let anyFailure = false;
  for (const response of responses) {
    if (response.status >= 500) status5xx.add(1);
    if (isFailureResponse(response)) anyFailure = true;
    check(response, { "mixed request did not 5xx": () => !isFailureResponse(response) });
  }
  mixedFailures.add(anyFailure ? 1 : 0);

  sleep(shortSleep(1));
}

export function aiTraffic() {
  if (isDryRun()) {
    return;
  }

  const baseUrl = backendUrl();
  const token = pickAuthToken();
  if (!token) throw new Error("Missing auth token for AI traffic");

  const message =
    __ENV.K6_CHAT_MESSAGE || "What is the difference between diversification and concentration risk?";

  const response = group("chat", () =>
    http.post(
      `${baseUrl}/api/chat`,
      JSON.stringify({
        message,
        max_tokens: 96,
        experience_level: getFirstNonEmptyEnv("K6_EXPERIENCE_LEVEL", "beginner"),
      }),
      {
        headers: jsonHeaders(loadTestHeaders(safety.runId, { Authorization: `Bearer ${token}` })),
        tags: { scenario: "ai_chat" },
      },
    ),
  );

  if (isRateLimited(response)) status429.add(1);
  if (response.status >= 500) status5xx.add(1);

  const cleanTermination = response.status === 200 || response.status === 429 || response.status === 503;
  chatFailures.add(cleanTermination ? 0 : 1);
  if (isRateLimited(response)) chatRateLimited.add(1);

  // k6's `timings.waiting` (time-to-first-byte) approximates time-to-first-token
  // for a streaming SSE endpoint; `timings.duration` approximates total completion time.
  chatFirstTokenMs.add(response.timings.waiting);
  chatCompletionMs.add(response.timings.duration);

  check(response, {
    "chat terminated cleanly (200/429/503)": () => cleanTermination,
  });

  sleep(shortSleep(2));
}

export const handleSummary = buildHandleSummary({ profile: "test-b-busy-beta", includesAi: true });
