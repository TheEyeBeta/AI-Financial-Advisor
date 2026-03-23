import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import {
  backendUrl,
  getFirstNonEmptyEnv,
  isFailureResponse,
  isRateLimited,
  jsonHeaders,
  pickAuthToken,
  shortSleep,
} from "./helpers.js";

const chatLatency = new Trend("chat_latency_ms");
const chatFailures = new Rate("chat_failures");
const chatRateLimited = new Counter("chat_rate_limited");

const MESSAGE = __ENV.K6_CHAT_MESSAGE || "What is the difference between diversification and concentration risk?";

export const options = {
  scenarios: {
    chat_load: {
      executor: "constant-vus",
      vus: 50,
      duration: getFirstNonEmptyEnv("K6_DURATION", "30s"),
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
      headers: jsonHeaders({
        Authorization: `Bearer ${token}`,
      }),
      tags: { scenario: "chat" },
    },
  );
}

export default function () {
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
