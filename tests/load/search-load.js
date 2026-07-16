import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { dryRunOptions, enforceSafety, isDryRun, loadTestHeaders, printDryRunPlan } from "./lib/safety.js";
import { buildHandleSummary } from "./lib/reporting.js";
import {
  backendUrl,
  getFirstNonEmptyEnv,
  isFailureResponse,
  jsonHeaders,
  pickAuthToken,
  shortSleep,
} from "./helpers.js";

const safety = enforceSafety({ requiresAi: false });

const searchLatency = new Trend("search_latency_ms");
const searchFailures = new Rate("search_failures");

export const options = isDryRun()
  ? dryRunOptions()
  : {
      scenarios: {
        search_load: {
          executor: "constant-vus",
          vus: Math.min(200, safety.maxVUs),
          duration: __ENV.LOAD_TEST_DURATION || "30s",
          gracefulStop: "10s",
        },
      },
      thresholds: {
        http_req_duration: ["p(95)<500"],
        search_failures: ["rate<0.01"],
      },
    };

function searchOnce() {
  const baseUrl = backendUrl();
  const token = pickAuthToken();
  if (!token) {
    throw new Error("Missing K6_AUTH_TOKEN, K6_AUTH_TOKENS, or SUPABASE_TEST_JWT for /api/search");
  }

  const query = __ENV.K6_SEARCH_QUERY || "What is a healthy gross margin for a software company?";
  const maxResults = __ENV.K6_SEARCH_RESULTS || "5";

  return http.get(
    `${baseUrl}/api/search?query=${encodeURIComponent(query)}&max_results=${encodeURIComponent(maxResults)}`,
    {
      headers: loadTestHeaders(safety.runId, { Authorization: `Bearer ${token}`, ...jsonHeaders() }),
      tags: { scenario: "search" },
    },
  );
}

export default function () {
  if (isDryRun()) {
    printDryRunPlan({
      target_environment: safety.targetHost,
      test_profile: "search-load (ad-hoc)",
      max_users: `${Math.min(200, safety.maxVUs || 0)} (requested) / ${safety.maxVUs} (LOAD_TEST_MAX_VUS)`,
      max_duration: __ENV.LOAD_TEST_DURATION || "30s",
      ai_request_budget: "none — search only, no AI provider calls",
      expected_request_volume: `~${Math.min(200, safety.maxVUs || 0)} requests per iteration cycle`,
      required_env_vars:
        "LOAD_TEST_CONFIRMED, LOAD_TEST_ALLOWED_HOSTS, LOAD_TEST_PRODUCTION_HOSTNAMES, " +
        "LOAD_TEST_ISOLATED_INFRA_CONFIRMED, K6_AUTH_TOKEN(S), LOAD_TEST_DEDICATED_USERS_CONFIRMED, " +
        "LOAD_TEST_MAX_VUS, LOAD_TEST_MAX_DURATION_SECONDS, LOAD_TEST_RUN_ID",
      destructive_or_failure_injection: false,
      safety_check_failures: safety.failures.length > 0 ? safety.failures : "none — all checks would pass",
    });
    return;
  }

  const response = group("search", () => searchOnce());

  searchLatency.add(response.timings.duration);
  searchFailures.add(isFailureResponse(response) ? 1 : 0);

  check(response, {
    "search returned 200 or 429": () => response.status === 200 || response.status === 429,
    "search did not return a 5xx": () => !isFailureResponse(response),
  });

  sleep(shortSleep(0.25));
}

export const handleSummary = buildHandleSummary({ profile: "search-load", includesAi: false });
