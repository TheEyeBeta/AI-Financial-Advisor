import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { dryRunOptions, enforceMaxDuration, enforceSafety, isDryRun, printDryRunPlan } from "./lib/safety.js";
import { buildHandleSummary } from "./lib/reporting.js";
import {
  cleanupTradeJournalRows,
  isFailureResponse,
  makeSymbol,
  paperTradingUserId,
  shortSleep,
  supabaseRestHeaders,
  supabaseServiceRoleKey,
  supabaseUrl,
  todayIso,
} from "./helpers.js";

// This test targets the real paper-trading write path the UI uses today:
// BUY and SELL journal entries written directly to Supabase.
//
// WARNING: this script uses the Supabase service-role key directly in VU
// code (bypassing RLS) rather than a per-user JWT, because it needs to
// write on behalf of a single designated load-test user without a real
// browser session. Never run this with `k6 run --http-debug` or any output
// mode that logs request headers — the service-role key would appear in
// that output. Prefer the Test A-D profile scripts (which use per-user
// JWTs, never the service-role key) unless this specific direct-write path
// is what you need to measure.
const safety = enforceSafety({ requiresAi: false, requiresSupabase: true });
const PAPER_TRADING_DURATION = __ENV.LOAD_TEST_DURATION || "30s";
enforceMaxDuration({ "paper-trading-load": PAPER_TRADING_DURATION }, safety.maxDurationSeconds);

// This profile additionally needs the service-role key and a dedicated test
// user, on top of enforceSafety()'s generic checks — validated here (not
// generically in safety.js, since only this one profile uses the
// service-role direct-write path) so a misconfigured run is refused before
// any request, not on the first VU's first iteration.
if (!isDryRun() && (!__ENV.SUPABASE_SERVICE_ROLE_KEY || !__ENV.PAPER_TRADING_USER_ID)) {
  throw new Error(
    "Refusing to run — SUPABASE_SERVICE_ROLE_KEY and PAPER_TRADING_USER_ID are both required for the " +
      "direct-write paper-trading profile.",
  );
}

const paperTradingLatency = new Trend("paper_trading_latency_ms");
const paperTradingFailures = new Rate("paper_trading_failures");

export const options = isDryRun()
  ? dryRunOptions()
  : {
      scenarios: {
        paper_trading_load: {
          executor: "constant-vus",
          vus: Math.min(100, safety.maxVUs),
          duration: PAPER_TRADING_DURATION,
          gracefulStop: "10s",
        },
      },
      thresholds: {
        http_req_duration: ["p(95)<500"],
        paper_trading_failures: ["rate<0.01"],
      },
    };

function writeJournalEntry(baseUrl, apiKey, payload) {
  return http.post(
    `${baseUrl}/rest/v1/trade_journal`,
    JSON.stringify(payload),
    {
      headers: supabaseRestHeaders(apiKey, "trading", {
        Prefer: "return=minimal",
        "X-Load-Test-Run-Id": safety.runId,
        "X-Load-Test": "true",
      }),
      tags: { scenario: payload.type === "BUY" ? "paper-open" : "paper-close" },
    },
  );
}

export default function () {
  if (isDryRun()) {
    printDryRunPlan({
      target_environment: safety.targetHost,
      test_profile: "paper-trading-load (ad-hoc, service-role direct write)",
      max_users: `${Math.min(100, safety.maxVUs || 0)} (requested) / ${safety.maxVUs} (LOAD_TEST_MAX_VUS)`,
      max_duration: PAPER_TRADING_DURATION,
      ai_request_budget: "none",
      expected_request_volume: `~${Math.min(100, safety.maxVUs || 0) * 3} requests per iteration cycle (buy+sell+cleanup)`,
      required_env_vars:
        "LOAD_TEST_CONFIRMED, LOAD_TEST_ALLOWED_HOSTS, LOAD_TEST_PRODUCTION_HOSTNAMES, " +
        "LOAD_TEST_ISOLATED_INFRA_CONFIRMED, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PAPER_TRADING_USER_ID, " +
        "LOAD_TEST_DEDICATED_USERS_CONFIRMED, LOAD_TEST_MAX_VUS, LOAD_TEST_MAX_DURATION_SECONDS, LOAD_TEST_RUN_ID",
      destructive_or_failure_injection:
        "writes and deletes trade_journal rows for PAPER_TRADING_USER_ID using the service-role key " +
        "(bypasses RLS) — confirm that user is a dedicated test account, never a real user",
      safety_check_failures: safety.failures.length > 0 ? safety.failures : "none — all checks would pass",
    });
    return;
  }

  let baseUrl = "";
  let apiKey = "";
  let userId = "";
  let symbol = "";
  let tradeDate = "";

  const quantity = Number(__ENV.K6_TRADE_QUANTITY || 10);
  const entryPrice = Number(__ENV.K6_ENTRY_PRICE || 100);
  const exitPrice = Number(__ENV.K6_EXIT_PRICE || 101);

  let buyResponse;
  let sellResponse;
  let cleanupResponse;

  try {
    baseUrl = supabaseUrl();
    apiKey = supabaseServiceRoleKey();
    userId = paperTradingUserId();
    symbol = makeSymbol("K6TRD");
    tradeDate = todayIso();

    buyResponse = group("open_trade", () =>
      writeJournalEntry(baseUrl, apiKey, {
        user_id: userId,
        symbol,
        type: "BUY",
        date: tradeDate,
        quantity,
        price: entryPrice,
        strategy: "k6-load-test",
        notes: "Synthetic BUY used for load testing",
        tags: ["k6", "load-test"],
        trade_id: null,
      }),
    );

    sellResponse = group("close_trade", () =>
      writeJournalEntry(baseUrl, apiKey, {
        user_id: userId,
        symbol,
        type: "SELL",
        date: tradeDate,
        quantity,
        price: exitPrice,
        strategy: "k6-load-test",
        notes: "Synthetic SELL used for load testing",
        tags: ["k6", "load-test"],
        trade_id: null,
      }),
    );
  } finally {
    if (baseUrl && apiKey && userId && symbol) {
      cleanupResponse = cleanupTradeJournalRows(baseUrl, apiKey, symbol, userId);
    }
  }

  const responseDurations = [buyResponse, sellResponse, cleanupResponse]
    .filter(Boolean)
    .map((response) => response.timings.duration);
  for (const duration of responseDurations) {
    paperTradingLatency.add(duration);
  }

  paperTradingFailures.add(
    [buyResponse, sellResponse, cleanupResponse].some((response) => isFailureResponse(response)) ? 1 : 0,
  );

  check(buyResponse, {
    "buy write succeeded": () => buyResponse.status === 201 || buyResponse.status === 204,
  });

  check(sellResponse, {
    "sell write succeeded": () => sellResponse.status === 201 || sellResponse.status === 204,
  });

  if (cleanupResponse) {
    check(cleanupResponse, {
      "cleanup succeeded": () => cleanupResponse.status === 200 || cleanupResponse.status === 204,
    });
  }

  sleep(shortSleep(0.25));
}

export const handleSummary = buildHandleSummary({ profile: "paper-trading-load", includesAi: false });
