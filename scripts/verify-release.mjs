#!/usr/bin/env node
/**
 * Release-verification smoke check (Phase 1 — exact-SHA enforcement).
 *
 * Confirms that a deployed frontend and backend both correspond to the
 * expected release SHA before the release is declared live:
 *
 *   - Frontend: fetches the served index.html and reads the
 *     <meta name="release-sha"> tag stamped at build time (vite.config.ts).
 *   - Backend: fetches /health and reads release.git_sha, release.app_version,
 *     and release.expected_schema_revision (app/health_checks.py).
 *
 * Usage:
 *   node scripts/verify-release.mjs \
 *     --expected-sha <full-git-sha> \
 *     [--frontend https://app.example.com] \
 *     [--backend https://api.example.com] \
 *     [--allow-short]   # accept prefix matches (Vercel/Railway may shorten)
 *
 * Exit codes: 0 = verified, 1 = mismatch/unverifiable, 2 = bad invocation.
 * See docs/readiness/RELEASE_POLICY.md for where this runs in the pipeline.
 */

const args = process.argv.slice(2);

function readFlag(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

const expectedSha = readFlag("--expected-sha");
const frontendUrl = readFlag("--frontend");
const backendUrl = readFlag("--backend");
const allowShort = args.includes("--allow-short");

if (!expectedSha || (!frontendUrl && !backendUrl)) {
  console.error(
    "usage: verify-release.mjs --expected-sha <sha> [--frontend <url>] [--backend <url>] [--allow-short]",
  );
  process.exit(2);
}

function shaMatches(actual, expected) {
  if (!actual) return false;
  if (actual === expected) return true;
  if (!allowShort) return false;
  // Prefix match either direction, minimum 7 chars to avoid trivial matches.
  const shorter = actual.length < expected.length ? actual : expected;
  const longer = actual.length < expected.length ? expected : actual;
  return shorter.length >= 7 && longer.startsWith(shorter);
}

let failed = false;

function report(label, ok, detail) {
  const status = ok ? "OK  " : "FAIL";
  console.log(`[${status}] ${label}: ${detail}`);
  if (!ok) failed = true;
}

async function checkFrontend() {
  const res = await fetch(frontendUrl, { redirect: "follow" });
  if (!res.ok) {
    report("frontend", false, `HTTP ${res.status} from ${frontendUrl}`);
    return;
  }
  const html = await res.text();
  const match = html.match(/<meta[^>]+name="release-sha"[^>]+content="([^"]*)"/);
  const served = match?.[1]?.trim();
  if (!served || served === "unknown") {
    report(
      "frontend",
      false,
      "no release-sha meta tag in served HTML (build did not receive VITE_RELEASE_SHA / VITE_VERCEL_GIT_COMMIT_SHA)",
    );
    return;
  }
  report(
    "frontend",
    shaMatches(served, expectedSha),
    `served=${served} expected=${expectedSha}`,
  );
}

async function checkBackend() {
  const res = await fetch(new URL("/health", backendUrl), { redirect: "follow" });
  if (!res.ok) {
    report("backend", false, `HTTP ${res.status} from ${backendUrl}/health`);
    return;
  }
  const body = await res.json();
  const release = body.release ?? {};
  const served = (release.git_sha ?? "").trim();
  if (!served) {
    report(
      "backend",
      false,
      "release.git_sha missing from /health (GIT_SHA / RAILWAY_GIT_COMMIT_SHA not set on the deployment)",
    );
    return;
  }
  report(
    "backend",
    shaMatches(served, expectedSha),
    `served=${served} expected=${expectedSha} app_version=${release.app_version ?? "?"} schema=${release.expected_schema_revision ?? "?"} env=${release.environment ?? "?"}`,
  );
}

try {
  if (frontendUrl) await checkFrontend();
  if (backendUrl) await checkBackend();
} catch (err) {
  report("fetch", false, err instanceof Error ? err.message : String(err));
}

if (failed) {
  console.error("\nRelease verification FAILED — deployed artifacts do not match the expected SHA.");
  process.exit(1);
}
console.log("\nRelease verification passed.");
