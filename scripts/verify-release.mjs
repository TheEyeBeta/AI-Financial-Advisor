#!/usr/bin/env node
/**
 * Release-verification smoke check (Phase 1 — exact-SHA enforcement).
 *
 * Confirms that a deployed frontend AND a deployed backend both correspond
 * to the expected release SHA before the release is declared live. Both
 * components are mandatory: this check must never pass having verified
 * only one of them.
 *
 *   - Frontend: fetches the served index.html and reads the
 *     <meta name="release-sha"> tag stamped at build time (vite.config.ts).
 *   - Backend: fetches /health and reads release.git_sha, release.app_version,
 *     release.expected_schema_revision, and release.environment
 *     (app/health_checks.py).
 *
 * Usage:
 *   node scripts/verify-release.mjs \
 *     --expected-sha <full-40-char-lowercase-git-sha> \
 *     --frontend https://app.example.com \
 *     --backend https://api.example.com \
 *     --allowed-hosts app.example.com,api.example.com \
 *     [--version-map path/to/release-version-map.json] \
 *     [--evidence-out path/to/evidence.json]
 *
 * --allowed-hosts may also be supplied via the RELEASE_ALLOWED_HOSTS env var
 * (comma-separated hostnames). At least one is required — there is no
 * default allowlist, by design: an unconfigured allowlist must fail closed,
 * not silently accept any host.
 *
 * Every outcome — including a bad invocation — writes the evidence file, so
 * the artifact upload in release-verification.yml always has something to
 * pick up and the audit trail is never silently missing a run.
 *
 * Exit codes: 0 = verified, 1 = mismatch/unverifiable, 2 = bad invocation.
 * See docs/readiness/RELEASE_POLICY.md for where this runs in the pipeline.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { verifyRelease, parseAllowlist, isFullSha, emptyEvidence } from "./lib/release-verify-core.mjs";

const args = process.argv.slice(2);

function readFlag(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

const expectedSha = readFlag("--expected-sha");
const frontendUrl = readFlag("--frontend");
const backendUrl = readFlag("--backend");
const allowedHostsArg = readFlag("--allowed-hosts") || process.env.RELEASE_ALLOWED_HOSTS;
const versionMapPath = readFlag("--version-map");
const evidenceOutPath = readFlag("--evidence-out") || "release-verification-evidence.json";

function failWithEvidence(errors, exitCode) {
  const evidence = emptyEvidence({ expectedSha, errors });
  writeFileSync(evidenceOutPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  for (const err of errors) {
    console.error(`[FAIL] ${err}`);
  }
  console.log(`\nEvidence written to ${evidenceOutPath}`);
  process.exit(exitCode);
}

if (!expectedSha || !frontendUrl || !backendUrl || !allowedHostsArg) {
  failWithEvidence(
    [
      "usage: verify-release.mjs --expected-sha <full-sha> --frontend <url> --backend <url> " +
        "--allowed-hosts <host1,host2> [--version-map <path>] [--evidence-out <path>] " +
        "(both --frontend and --backend are required; --allowed-hosts may come from RELEASE_ALLOWED_HOSTS)",
    ],
    2,
  );
}

if (!isFullSha(expectedSha)) {
  failWithEvidence(
    [`usage error: --expected-sha must be a full 40-character lowercase git SHA, got "${expectedSha}"`],
    2,
  );
}

let versionMap;
if (versionMapPath) {
  try {
    versionMap = JSON.parse(readFileSync(versionMapPath, "utf8"));
  } catch (err) {
    failWithEvidence(
      [
        `usage error: could not read/parse --version-map ${versionMapPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
      2,
    );
  }
}

const allowedHosts = parseAllowlist(allowedHostsArg);

const evidence = await verifyRelease({
  expectedSha,
  frontendUrl,
  backendUrl,
  allowedHosts,
  versionMap,
});

writeFileSync(evidenceOutPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");

for (const err of evidence.errors) {
  console.error(`[FAIL] ${err}`);
}
if (evidence.frontend) {
  console.log(`[${evidence.frontend.ok ? "OK  " : "FAIL"}] frontend: ${evidence.frontend.detail}`);
}
if (evidence.backend) {
  console.log(`[${evidence.backend.ok ? "OK  " : "FAIL"}] backend: ${evidence.backend.detail}`);
}
console.log(`\nEvidence written to ${evidenceOutPath}`);

if (evidence.verdict !== "pass") {
  console.error("\nRelease verification FAILED — deployed artifacts do not match the expected SHA.");
  process.exit(1);
}
console.log("\nRelease verification passed.");
