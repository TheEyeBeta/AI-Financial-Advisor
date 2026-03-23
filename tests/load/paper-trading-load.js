import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
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
const paperTradingLatency = new Trend("paper_trading_latency_ms");
const paperTradingFailures = new Rate("paper_trading_failures");

export const options = {
  scenarios: {
    paper_trading_load: {
      executor: "constant-vus",
      vus: 100,
      duration: __ENV.K6_DURATION || "30s",
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
      }),
      tags: { scenario: payload.type === "BUY" ? "paper-open" : "paper-close" },
    },
  );
}

export default function () {
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
