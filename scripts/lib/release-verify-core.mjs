/**
 * Core logic for release verification (Phase 1 — exact-SHA enforcement).
 *
 * Kept separate from the CLI entrypoint (scripts/verify-release.mjs) so it
 * can be unit-tested with `node --test` without performing real network
 * calls (fetch is injected).
 *
 * See docs/readiness/RELEASE_POLICY.md for where this runs in the pipeline.
 */

const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

export function isFullSha(value) {
  return typeof value === "string" && FULL_SHA_RE.test(value);
}

export function shaMatches(actual, expected) {
  if (!actual || !expected) return false;
  return actual.trim().toLowerCase() === expected.trim().toLowerCase();
}

/** Strips query string and fragment from a URL for safe inclusion in evidence/logs. */
export function stripQueryForEvidence(urlString) {
  try {
    const u = new URL(urlString);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return "invalid-url";
  }
}

export function parseAllowlist(csv) {
  return new Set(
    String(csv || "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

export class UrlValidationError extends Error {}

/**
 * Parses and validates a verification target URL. Rejects anything that
 * cannot be trusted as "the deployment we intend to check":
 *   - not parseable as a URL
 *   - non-HTTPS scheme
 *   - missing hostname
 *   - embedded userinfo (credentials in the URL)
 *   - a fragment
 *   - a hostname outside the caller-supplied allowlist
 */
export function validateTargetUrl(urlString, allowedHosts, label) {
  if (!urlString || typeof urlString !== "string") {
    throw new UrlValidationError(`${label}: URL is required`);
  }

  let url;
  try {
    url = new URL(urlString);
  } catch {
    throw new UrlValidationError(`${label}: "${urlString}" is not a valid URL`);
  }

  if (url.protocol !== "https:") {
    throw new UrlValidationError(
      `${label}: must be HTTPS, got "${url.protocol}" (${urlString})`,
    );
  }
  if (!url.hostname) {
    throw new UrlValidationError(`${label}: URL is missing a hostname (${urlString})`);
  }
  if (url.username || url.password) {
    throw new UrlValidationError(
      `${label}: must not embed credentials in the URL`,
    );
  }
  if (url.hash) {
    throw new UrlValidationError(`${label}: must not include a fragment (${urlString})`);
  }

  const hostname = url.hostname.toLowerCase();
  if (!allowedHosts || allowedHosts.size === 0) {
    throw new UrlValidationError(
      `${label}: no approved host allowlist configured — refusing to verify an arbitrary host`,
    );
  }
  if (!allowedHosts.has(hostname)) {
    throw new UrlValidationError(
      `${label}: host "${hostname}" is not in the approved allowlist`,
    );
  }

  return url;
}

/** Fails if the final (post-redirect) response host differs from the originally approved host. */
export function assertSameHost(label, approvedHostname, finalUrlString) {
  let finalHostname;
  try {
    finalHostname = new URL(finalUrlString).hostname.toLowerCase();
  } catch {
    throw new UrlValidationError(`${label}: redirect target is not a valid URL (${finalUrlString})`);
  }
  if (finalHostname !== approvedHostname.toLowerCase()) {
    throw new UrlValidationError(
      `${label}: redirected off the approved host: requested ${approvedHostname}, served by ${finalHostname}`,
    );
  }
}

/**
 * Determines the app_version this release is expected to report.
 * Defaults to requiring app_version === expectedSha (SHA-as-version). If an
 * explicit version map (expectedSha -> app_version) is supplied, that
 * mapping's value is used instead — this is the only sanctioned way to
 * decouple app_version from the git SHA.
 */
export function resolveExpectedAppVersion(expectedSha, versionMap) {
  if (versionMap && Object.prototype.hasOwnProperty.call(versionMap, expectedSha)) {
    return versionMap[expectedSha];
  }
  return expectedSha;
}

/**
 * Verifies the frontend target: fetches it, confirms no off-host redirect,
 * and reads the <meta name="release-sha"> tag stamped at build time.
 */
export async function checkFrontend({ url, allowedHosts, expectedSha, fetchImpl }) {
  const validated = validateTargetUrl(url, allowedHosts, "frontend");
  const approvedHostname = validated.hostname;

  const res = await fetchImpl(validated.toString(), { redirect: "follow" });
  assertSameHost("frontend", approvedHostname, res.url || validated.toString());

  if (!res.ok) {
    return {
      ok: false,
      detail: `HTTP ${res.status} from ${stripQueryForEvidence(validated.toString())}`,
      sha: null,
    };
  }

  const html = await res.text();
  const match = html.match(/<meta[^>]+name="release-sha"[^>]+content="([^"]*)"/);
  const served = match?.[1]?.trim();

  if (!served || served === "unknown") {
    return {
      ok: false,
      detail:
        "no release-sha meta tag in served HTML (build did not receive VITE_RELEASE_SHA / VITE_VERCEL_GIT_COMMIT_SHA)",
      sha: served ?? null,
    };
  }

  const ok = shaMatches(served, expectedSha);
  return {
    ok,
    detail: ok ? `served=${served}` : `served=${served} expected=${expectedSha}`,
    sha: served,
  };
}

/**
 * Verifies the backend target: fetches /health and confirms git_sha,
 * app_version, expected_schema_revision, and environment are all present
 * and consistent with the expected release.
 */
export async function checkBackend({ url, allowedHosts, expectedSha, versionMap, fetchImpl }) {
  const validated = validateTargetUrl(url, allowedHosts, "backend");
  const approvedHostname = validated.hostname;
  const healthUrl = new URL("/health", validated);

  const res = await fetchImpl(healthUrl.toString(), { redirect: "follow" });
  assertSameHost("backend", approvedHostname, res.url || healthUrl.toString());

  if (!res.ok) {
    return {
      ok: false,
      detail: `HTTP ${res.status} from ${stripQueryForEvidence(healthUrl.toString())}`,
      sha: null,
      app_version: null,
      expected_schema_revision: null,
      environment: null,
    };
  }

  const body = await res.json();
  const release = body.release ?? {};
  const served = (release.git_sha ?? "").trim();
  const appVersion = (release.app_version ?? "").trim();
  const schemaRevision = (release.expected_schema_revision ?? "").trim();
  const environment = (release.environment ?? "").trim();

  const problems = [];
  if (!served) {
    problems.push(
      "release.git_sha missing from /health (GIT_SHA / RAILWAY_GIT_COMMIT_SHA not set on the deployment)",
    );
  } else if (!shaMatches(served, expectedSha)) {
    problems.push(`git_sha mismatch: served=${served} expected=${expectedSha}`);
  }

  if (!appVersion) {
    problems.push("release.app_version missing from /health");
  } else {
    const expectedAppVersion = resolveExpectedAppVersion(expectedSha, versionMap);
    if (appVersion !== expectedAppVersion) {
      problems.push(
        `app_version mismatch: served=${appVersion} expected=${expectedAppVersion}`,
      );
    }
  }

  if (!schemaRevision) {
    problems.push("release.expected_schema_revision missing from /health");
  }

  if (!environment) {
    problems.push("release.environment missing from /health");
  }

  const ok = problems.length === 0;
  return {
    ok,
    detail: ok
      ? `served=${served} app_version=${appVersion} schema=${schemaRevision} env=${environment}`
      : problems.join("; "),
    sha: served || null,
    app_version: appVersion || null,
    expected_schema_revision: schemaRevision || null,
    environment: environment || null,
  };
}

/**
 * Runs full release verification. Both frontend and backend are mandatory —
 * a canonical verification run must never pass having checked only one
 * component. Returns an evidence object suitable for JSON serialization and
 * an overall pass/fail verdict.
 */
export async function verifyRelease({
  expectedSha,
  frontendUrl,
  backendUrl,
  allowedHosts,
  versionMap,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const evidence = {
    schema_version: 1,
    timestamp: now().toISOString(),
    expected_sha: expectedSha,
    frontend: null,
    backend: null,
    verdict: "fail",
    errors: [],
  };

  if (!isFullSha(expectedSha)) {
    evidence.errors.push(
      `expected-sha must be a full 40-character git SHA, got "${expectedSha}"`,
    );
  }
  if (!frontendUrl || !backendUrl) {
    evidence.errors.push(
      "both a frontend URL and a backend URL are required — release verification must never pass having checked only one component",
    );
  }

  if (evidence.errors.length > 0) {
    return evidence;
  }

  let frontendResult;
  try {
    frontendResult = await checkFrontend({
      url: frontendUrl,
      allowedHosts,
      expectedSha,
      fetchImpl,
    });
  } catch (err) {
    frontendResult = { ok: false, detail: err instanceof Error ? err.message : String(err), sha: null };
  }
  evidence.frontend = {
    url: stripQueryForEvidence(frontendUrl),
    ok: frontendResult.ok,
    sha: frontendResult.sha,
    detail: frontendResult.detail,
  };

  let backendResult;
  try {
    backendResult = await checkBackend({
      url: backendUrl,
      allowedHosts,
      expectedSha,
      versionMap,
      fetchImpl,
    });
  } catch (err) {
    backendResult = {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      sha: null,
      app_version: null,
      expected_schema_revision: null,
      environment: null,
    };
  }
  evidence.backend = {
    url: stripQueryForEvidence(backendUrl),
    ok: backendResult.ok,
    sha: backendResult.sha,
    app_version: backendResult.app_version,
    expected_schema_revision: backendResult.expected_schema_revision,
    environment: backendResult.environment,
    detail: backendResult.detail,
  };

  evidence.verdict = evidence.frontend.ok && evidence.backend.ok ? "pass" : "fail";
  return evidence;
}
