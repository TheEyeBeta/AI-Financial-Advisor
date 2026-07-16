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
} from "./helpers.js";

// AI-backed — costs real provider spend, so this counts as an AI scenario
// for the safety gate even though it's a simpler ad-hoc script than the
// Test A-D profiles.
const safety = enforceSafety({ requiresAi: true });

const chatLatency = new Trend("chat_latency_ms");
const chatFailures = new Rate("chat_failures");
const chatRateLimited = new Counter("chat_rate_limited");

const MESSAGE = __ENV.K6_CHAT_MESSAGE || "What is the difference between diversification and concentration risk?";

export const options = isDryRun()
  ? dryRunOptions()
  : {
      scenarios: {
        chat_load: {
          executor: "constant-vus",
          vus: Math.min(50, safety.maxVUs),
          duration: __ENV.LOAD_TEST_DURATION || "30s",
          gracefulStop: "10s",
        },
      },
      thresholds: {
        http_req_duration: ["p(95)<500"],
        chat_failures: ["rate<0.01"],
        chat_rate_limited: ["count>0"],
      },
    };

function postChat() {
  const baseUrl = backendUrl();
  const token = pickAuthToken();
  if (!token) {
    throw new Error("Missing K6_AUTH_TOKEN, K6_AUTH_TOKENS, or SUPABASE_TEST_JWT for /api/chat");
  }

  return http.post(
    `${baseUrl}/api/chat`,
    JSON.stringify({
      message: MESSAGE,
      max_tokens: 96,
      experience_level: getFirstNonEmptyEnv("K6_EXPERIENCE_LEVEL", "beginner"),
    }),
    {
      headers: jsonHeaders(loadTestHeaders(safety.runId, { Authorization: `Bearer ${token}` })),
      tags: { scenario: "chat" },
    },
  );
}

export default function () {
  if (isDryRun()) {
    printDryRunPlan({
      target_environment: safety.targetHost,
      test_profile: "chat-load (ad-hoc)",
      max_users: `${Math.min(50, safety.maxVUs || 0)} (requested) / ${safety.maxVUs} (LOAD_TEST_MAX_VUS)`,
      max_duration: __ENV.LOAD_TEST_DURATION || "30s",
      ai_request_budget: "1 AI request per VU iteration (paid — ALLOW_PAID_AI_LOAD required)",
      expected_request_volume: `~${Math.min(50, safety.maxVUs || 0)} requests per iteration cycle`,
      required_env_vars:
        "LOAD_TEST_CONFIRMED, LOAD_TEST_ALLOWED_HOSTS, LOAD_TEST_PRODUCTION_HOSTNAMES, " +
        "LOAD_TEST_ISOLATED_INFRA_CONFIRMED, K6_AUTH_TOKEN(S), LOAD_TEST_DEDICATED_USERS_CONFIRMED, " +
        "LOAD_TEST_MAX_VUS, LOAD_TEST_MAX_DURATION_SECONDS, ALLOW_PAID_AI_LOAD, LOAD_TEST_RUN_ID",
      destructive_or_failure_injection: false,
      safety_check_failures: safety.failures.length > 0 ? safety.failures : "none — all checks would pass",
    });
    return;
  }

  const response = group("chat", () => postChat());
  const allowedStatus = response.status === 200 || response.status === 429;

  chatLatency.add(response.timings.duration);
  chatFailures.add(isFailureResponse(response) ? 1 : 0);

  if (isRateLimited(response)) {
    chatRateLimited.add(1);
  }

  check(response, {
    "chat returned 200 or 429": () => allowedStatus,
    "chat did not return a 5xx": () => !isFailureResponse(response),
  });

  sleep(shortSleep(0.5));
}

export const handleSummary = buildHandleSummary({ profile: "chat-load", includesAi: true });
