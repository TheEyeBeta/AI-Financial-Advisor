// Test A — Normal browsing (readiness spec).
// 150 registered test users, 30 concurrent, read-mostly traffic across
// Dashboard, Academy, profile, and stock views. No AI calls, no writes.
//
// Run via: scripts/run-load-test.sh a
// Dry run: DRY_RUN=true scripts/run-load-test.sh a

import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { dryRunOptions, enforceMaxDuration, enforceSafety, isDryRun, loadTestHeaders, printDryRunPlan } from "./lib/safety.js";
import { buildHandleSummary } from "./lib/reporting.js";
import {
  backendUrl,
  jsonHeaders,
  pickAuthToken,
  shortSleep,
  supabaseRestHeaders,
  supabaseUrl,
  isFailureResponse,
} from "./helpers.js";

const safety = enforceSafety({ requiresAi: false, requiresSupabase: true });
const BROWSING_DURATION = __ENV.LOAD_TEST_DURATION || "5m";
enforceMaxDuration({ "normal-browsing": BROWSING_DURATION }, safety.maxDurationSeconds);

const status2xx = new Counter("http_status_2xx");
const status4xx = new Counter("http_status_4xx");
const status5xx = new Counter("http_status_5xx");
const browseLatency = new Trend("browse_latency_ms");
const browseFailures = new Rate("browse_failures");

export const options = isDryRun()
  ? dryRunOptions()
  : {
      scenarios: {
        normal_browsing: {
          executor: "constant-vus",
          vus: Math.min(30, safety.maxVUs),
          duration: BROWSING_DURATION,
          gracefulStop: "30s",
        },
      },
      thresholds: {
        // Mirrors docs/SLO.md #2/#3 (normal API latency) and #6 (unhandled 5xx rate).
        http_req_duration: ["p(95)<500", "p(99)<1500"],
        browse_failures: ["rate<0.005"],
      },
    };

function tagStatus(response) {
  if (response.status >= 500) status5xx.add(1);
  else if (response.status >= 400) status4xx.add(1);
  else if (response.status >= 200) status2xx.add(1);
}

function browseDashboard(token, sbUrl, sbHeaders) {
  return group("dashboard", () => {
    const responses = [
      http.get(`${sbUrl}/rest/v1/users?select=id,first_name,userType&limit=1`, {
        headers: sbHeaders,
        tags: { scenario: "dashboard_profile" },
      }),
      http.get(`${sbUrl}/rest/v1/open_positions?select=id,symbol,quantity&limit=20`, {
        headers: supabaseRestHeaders(__ENV.SUPABASE_ANON_KEY, "trading", {
          Authorization: `Bearer ${token}`,
        }),
        tags: { scenario: "dashboard_positions" },
      }),
      http.get(`${sbUrl}/rest/v1/portfolio_history?select=date,value&order=date.desc&limit=30`, {
        headers: supabaseRestHeaders(__ENV.SUPABASE_ANON_KEY, "trading", {
          Authorization: `Bearer ${token}`,
        }),
        tags: { scenario: "dashboard_history" },
      }),
    ];
    return responses;
  });
}

function browseAcademy(sbUrl, sbHeaders) {
  return group("academy", () => {
    const academyHeaders = supabaseRestHeaders(__ENV.SUPABASE_ANON_KEY, "academy", sbHeaders);
    return [
      http.get(`${sbUrl}/rest/v1/tiers?select=id,name,slug&limit=10`, {
        headers: academyHeaders,
        tags: { scenario: "academy_tiers" },
      }),
      http.get(`${sbUrl}/rest/v1/lessons?select=id,title,slug&limit=20`, {
        headers: academyHeaders,
        tags: { scenario: "academy_lessons" },
      }),
    ];
  });
}

function browseStockViews(baseUrl, token) {
  return group("stock_views", () => {
    const headers = loadTestHeaders(safety.runId, jsonHeaders({ Authorization: `Bearer ${token}` }));
    const ticker = __ENV.K6_TICKER || "AAPL";
    return [
      http.get(`${baseUrl}/api/stocks/ranking?limit=20`, { headers, tags: { scenario: "stock_ranking" } }),
      http.get(`${baseUrl}/api/stock-price/${ticker}`, { headers, tags: { scenario: "stock_price" } }),
      http.get(`${baseUrl}/api/v1/engine/status`, { headers, tags: { scenario: "engine_status" } }),
    ];
  });
}

function browseProfile(sbUrl, sbHeaders) {
  return group("profile", () =>
    http.get(`${sbUrl}/rest/v1/user_profiles?select=risk_profile,investment_horizon&limit=1`, {
      headers: sbHeaders,
      tags: { scenario: "profile_settings" },
    }),
  );
}

export default function () {
  if (isDryRun()) {
    printDryRunPlan({
      target_environment: safety.targetHost,
      test_profile: "Test A — Normal browsing",
      max_users: `30 (requested) / ${safety.maxVUs} (LOAD_TEST_MAX_VUS)`,
      max_duration: BROWSING_DURATION,
      ai_request_budget: "none — Test A has no AI calls",
      expected_request_volume: "~9 requests per VU per iteration (dashboard x3, academy x2, stock views x3, profile x1)",
      required_env_vars:
        "LOAD_TEST_CONFIRMED, LOAD_TEST_ALLOWED_HOSTS, LOAD_TEST_PRODUCTION_HOSTNAMES, " +
        "LOAD_TEST_ISOLATED_INFRA_CONFIRMED, K6_AUTH_TOKEN(S), LOAD_TEST_DEDICATED_USERS_CONFIRMED, " +
        "LOAD_TEST_MAX_VUS, LOAD_TEST_MAX_DURATION_SECONDS, LOAD_TEST_RUN_ID, SUPABASE_URL, SUPABASE_ANON_KEY",
      destructive_or_failure_injection: false,
      safety_check_failures: safety.failures.length > 0 ? safety.failures : "none — all checks would pass",
    });
    return;
  }

  const baseUrl = backendUrl();
  const sbUrl = supabaseUrl();
  const token = pickAuthToken();
  if (!token) {
    throw new Error("Missing K6_AUTH_TOKEN, K6_AUTH_TOKENS, or SUPABASE_TEST_JWT");
  }
  const sbHeaders = supabaseRestHeaders(__ENV.SUPABASE_ANON_KEY, "core", {
    Authorization: `Bearer ${token}`,
    ...loadTestHeaders(safety.runId),
  });

  const allResponses = [
    ...browseDashboard(token, sbUrl, sbHeaders),
    ...browseAcademy(sbUrl, sbHeaders),
    ...browseStockViews(baseUrl, token),
    browseProfile(sbUrl, sbHeaders),
  ];

  let anyFailure = false;
  for (const response of allResponses) {
    tagStatus(response);
    browseLatency.add(response.timings.duration);
    if (isFailureResponse(response)) anyFailure = true;
    check(response, { "did not return a 5xx": () => !isFailureResponse(response) });
  }
  browseFailures.add(anyFailure ? 1 : 0);

  sleep(shortSleep(1));
}

export const handleSummary = buildHandleSummary({ profile: "test-a-normal-browsing", includesAi: false });
