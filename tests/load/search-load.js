import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import {
  backendUrl,
  getFirstNonEmptyEnv,
  isFailureResponse,
  jsonHeaders,
  pickAuthToken,
  shortSleep,
} from "./helpers.js";

const searchLatency = new Trend("search_latency_ms");
const searchFailures = new Rate("search_failures");

export const options = {
  scenarios: {
    search_load: {
      executor: "constant-vus",
      vus: 200,
      duration: getFirstNonEmptyEnv("K6_DURATION", "30s"),
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
      headers: jsonHeaders({
        Authorization: `Bearer ${token}`,
      }),
      tags: { scenario: "search" },
    },
  );
}

export default function () {
  const response = group("search", () => searchOnce());

  searchLatency.add(response.timings.duration);
  searchFailures.add(isFailureResponse(response) ? 1 : 0);

  check(response, {
    "search returned 200 or 429": () => response.status === 200 || response.status === 429,
    "search did not return a 5xx": () => !isFailureResponse(response),
  });

  sleep(shortSleep(0.25));
}
