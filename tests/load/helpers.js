import http from "k6/http";

export function requireEnv(name) {
  const value = (__ENV[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getFirstNonEmptyEnv(...names) {
  for (const name of names) {
    const value = (__ENV[name] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

export function jsonHeaders(extraHeaders = {}) {
  return {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
}

export function supabaseRestHeaders(apiKey, profile, extraHeaders = {}) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(profile ? { "Accept-Profile": profile } : {}),
    ...extraHeaders,
  };
}

export function parseTokenPool(rawValue) {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    return rawValue
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function pickAuthToken() {
  const pooledTokens = parseTokenPool(getFirstNonEmptyEnv("K6_AUTH_TOKENS_JSON", "K6_AUTH_TOKENS"));
  if (pooledTokens.length > 0) {
    return pooledTokens[(__VU - 1) % pooledTokens.length];
  }

  return getFirstNonEmptyEnv("K6_AUTH_TOKEN", "SUPABASE_TEST_JWT");
}

export function backendUrl() {
  return requireEnv("BACKEND_URL").replace(/\/+$/, "");
}

export function supabaseUrl() {
  return requireEnv("SUPABASE_URL").replace(/\/+$/, "");
}

export function supabaseServiceRoleKey() {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
}

export function paperTradingUserId() {
  return requireEnv("PAPER_TRADING_USER_ID");
}

export function makeSymbol(prefix = "K6PT") {
  return `${prefix}-${__VU.toString().padStart(4, "0")}-${Date.now().toString(36)}`;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function shortSleep(seconds = 1) {
  return Math.max(0, seconds);
}

export function isFailureResponse(response) {
  return response.status >= 500 || response.status === 0;
}

export function isRateLimited(response) {
  return response.status === 429;
}

export function cleanupTradeJournalRows(baseUrl, apiKey, symbol, userId) {
  const response = http.del(
    `${baseUrl}/rest/v1/trade_journal?symbol=eq.${encodeURIComponent(symbol)}&user_id=eq.${encodeURIComponent(userId)}`,
    null,
    {
      headers: supabaseRestHeaders(apiKey, "trading", { Prefer: "return=minimal" }),
    },
  );

  return response;
}
