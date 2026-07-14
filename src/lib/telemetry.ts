import type { Breadcrumb, ErrorEvent, Event, EventHint } from "@sentry/react";
import * as Sentry from "@sentry/react";

/**
 * Sentry privacy hardening (issue #204).
 *
 * Policy (see docs/security/TELEMETRY_PRIVACY.md):
 * - No default PII: no IP addresses, no emails, no usernames.
 * - Pseudonymous user identifier only (Supabase UUID), when already set.
 * - Query strings, auth material, prompts, and profile/portfolio values are
 *   redacted before any event leaves the browser.
 * - Low production trace baseline with targeted sampling for critical routes.
 * - Session Replay stays disabled until it passes an explicit privacy review.
 */

export const REDACTED = "[redacted]";

/** Key names whose values are always redacted, wherever they appear. */
const SENSITIVE_KEY_PATTERN = new RegExp(
  [
    "authorization",
    "auth[-_]?token",
    "access[-_]?token",
    "refresh[-_]?token",
    "id[-_]?token",
    "token",
    "secret",
    "password",
    "passwd",
    "cookie",
    "set-cookie",
    "session",
    "jwt",
    "api[-_]?key",
    "prompt",
    "message",
    "content",
    "email",
    "e[-_]?mail",
    "phone",
    "address",
    "ssn",
    "dob",
    "birth",
    "portfolio",
    "holding",
    "position",
    "balance",
    "net[-_]?worth",
    "income",
    "salary",
    "profile",
    "first[-_]?name",
    "last[-_]?name",
    "full[-_]?name",
  ].join("|"),
  "i",
);

/** Patterns scrubbed out of free-form strings (messages, stack values, URLs). */
const JWT_PATTERN = /eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g;
const BEARER_PATTERN = /bearer\s+[\w.~+/-]+=*/gi;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const API_KEY_PATTERN = /\b(?:sk|pk|phc|pplx|tvly|rk)[-_][\w-]{8,}\b/g;

const MAX_SCRUB_DEPTH = 8;

/** Removes query string and fragment; both routinely carry tokens/ids. */
export function stripUrlQuery(url: string): string {
  const separator = url.search(/[?#]/);
  return separator === -1 ? url : url.slice(0, separator);
}

/** Scrubs token/email/key material out of a free-form string. */
export function scrubText(text: string): string {
  return text
    .replace(JWT_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, REDACTED)
    .replace(API_KEY_PATTERN, REDACTED)
    .replace(EMAIL_PATTERN, REDACTED);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** Deeply scrubs an arbitrary value: sensitive keys are dropped wholesale, strings are pattern-scrubbed. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_SCRUB_DEPTH) return REDACTED;
  if (typeof value === "string") {
    const stripped = value.startsWith("http") ? stripUrlQuery(value) : value;
    return scrubText(stripped);
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return scrubText(`${value.name}: ${value.message}`);
  }
  if (value !== null && typeof value === "object") {
    // Non-plain objects (Map, Set, RegExp, class instances…) have no own
    // enumerable entries to walk — Object.entries would silently collapse
    // them to {}. Preserve a scrubbed string form instead.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      return scrubText(String(value));
    }
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED : scrubValue(entry, depth + 1);
    }
    return result;
  }
  return value;
}

function scrubRecord(
  record: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!record) return record;
  return scrubValue(record) as Record<string, unknown>;
}

/** Strips query strings and auth material from a breadcrumb; drops console breadcrumbs entirely. */
export function redactBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === "console") {
    // Console output routinely echoes prompts and API payloads; never ship it.
    return null;
  }
  const redacted: Breadcrumb = { ...breadcrumb };
  if (typeof redacted.message === "string") {
    redacted.message = scrubText(redacted.message);
  }
  if (redacted.data) {
    redacted.data = scrubValue(redacted.data) as Record<string, unknown>;
    if (typeof redacted.data.url === "string") {
      redacted.data.url = stripUrlQuery(redacted.data.url);
    }
  }
  return redacted;
}

/**
 * Redacts a Sentry event in place-safe copy before transmission.
 * Applied to both error events (`beforeSend`) and transactions
 * (`beforeSendTransaction`).
 */
export function redactSentryEvent<T extends Event>(event: T, _hint?: EventHint): T {
  const redacted: T = { ...event };

  // Pseudonymous identity only: keep the opaque UUID, never email/IP/username.
  if (redacted.user) {
    redacted.user = redacted.user.id ? { id: redacted.user.id } : undefined;
  }

  if (redacted.request) {
    const { url, headers: _headers, ...rest } = redacted.request;
    redacted.request = {
      ...rest,
      // Headers can carry Authorization/Cookie; drop them wholesale.
      headers: undefined,
      cookies: undefined,
      data: undefined,
      query_string: undefined,
      url: typeof url === "string" ? stripUrlQuery(url) : url,
    };
  }

  if (typeof redacted.transaction === "string") {
    redacted.transaction = stripUrlQuery(redacted.transaction);
  }
  if (typeof redacted.message === "string") {
    redacted.message = scrubText(redacted.message);
  }

  if (redacted.exception?.values) {
    redacted.exception = {
      ...redacted.exception,
      values: redacted.exception.values.map((value) => ({
        ...value,
        value: typeof value.value === "string" ? scrubText(value.value) : value.value,
      })),
    };
  }

  if (redacted.breadcrumbs) {
    redacted.breadcrumbs = redacted.breadcrumbs
      .map((breadcrumb) => redactBreadcrumb(breadcrumb))
      .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null);
  }

  redacted.extra = scrubRecord(redacted.extra);
  redacted.contexts = scrubRecord(redacted.contexts) as T["contexts"];
  if (redacted.tags) {
    redacted.tags = scrubValue(redacted.tags) as T["tags"];
  }

  return redacted;
}

/** Route prefixes that keep a higher trace sample in production. */
const CRITICAL_ROUTE_PREFIXES = ["/advisor", "/auth", "/onboarding", "/paper-trading"];

export const PRODUCTION_BASELINE_TRACE_RATE = 0.05;
export const PRODUCTION_CRITICAL_TRACE_RATE = 0.25;

export function sampleTransaction(mode: string, transactionName: string | undefined): number {
  if (mode !== "production") return 1.0;
  if (
    transactionName &&
    CRITICAL_ROUTE_PREFIXES.some((prefix) => transactionName.startsWith(prefix))
  ) {
    return PRODUCTION_CRITICAL_TRACE_RATE;
  }
  return PRODUCTION_BASELINE_TRACE_RATE;
}

export interface TelemetryEnv {
  MODE: string;
  VITE_SENTRY_DSN?: string;
  VITE_RELEASE_SHA?: string;
  VITE_VERCEL_GIT_COMMIT_SHA?: string;
}

export function getReleaseSha(env: TelemetryEnv): string | undefined {
  const release = (env.VITE_RELEASE_SHA || env.VITE_VERCEL_GIT_COMMIT_SHA || "").trim();
  return release || undefined;
}

/** Builds the full Sentry.init options; pure so tests can inspect the policy. */
export function buildSentryOptions(env: TelemetryEnv): Sentry.BrowserOptions {
  return {
    dsn: env.VITE_SENTRY_DSN?.trim(),
    environment: env.MODE,
    release: getReleaseSha(env),
    // Privacy hardening (#204): never collect default PII, and keep Session
    // Replay off until it passes an explicit privacy review.
    sendDefaultPii: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampler: ({ name }) => sampleTransaction(env.MODE, name),
    beforeSend: (event: ErrorEvent, hint: EventHint) => redactSentryEvent(event, hint),
    beforeSendTransaction: (event, hint) => redactSentryEvent(event, hint),
    beforeBreadcrumb: (breadcrumb: Breadcrumb) => redactBreadcrumb(breadcrumb),
  };
}

/** Initializes Sentry when a DSN is configured; no-op otherwise. */
export function initTelemetry(env: TelemetryEnv = import.meta.env as unknown as TelemetryEnv): void {
  const options = buildSentryOptions(env);
  if (!options.dsn) return;
  Sentry.init(options);
}
