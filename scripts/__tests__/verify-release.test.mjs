import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyRelease, parseAllowlist } from "../lib/release-verify-core.mjs";

const EXPECTED_SHA = "a".repeat(40);
const SHORT_SHA = "a".repeat(7);
const OTHER_SHA = "b".repeat(40);

const FRONTEND_URL = "https://app.example.com/";
const BACKEND_URL = "https://api.example.com/";
const ALLOWED_HOSTS = parseAllowlist("app.example.com,api.example.com");

function htmlWithSha(sha) {
  return `<html><head><meta name="release-sha" content="${sha}"></head><body></body></html>`;
}

function fakeFetch({
  frontendHtml,
  backendBody,
  frontendUrlOverride,
  backendUrlOverride,
  frontendStatus = 200,
  backendStatus = 200,
  recordedOpts,
} = {}) {
  return async (url, opts) => {
    recordedOpts?.push(opts);
    const u = new URL(url);
    if (u.pathname === "/health") {
      return {
        ok: backendStatus >= 200 && backendStatus < 300,
        status: backendStatus,
        url: backendUrlOverride || url,
        json: async () => backendBody ?? {},
      };
    }
    return {
      ok: frontendStatus >= 200 && frontendStatus < 300,
      status: frontendStatus,
      url: frontendUrlOverride || url,
      text: async () => frontendHtml ?? "",
    };
  };
}

function goodBackendBody(overrides = {}) {
  return {
    release: {
      git_sha: EXPECTED_SHA,
      app_version: EXPECTED_SHA,
      expected_schema_revision: "0001_init",
      environment: "production",
      ...overrides,
    },
  };
}

test("successful exact match: frontend + backend both verified", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({ frontendHtml: htmlWithSha(EXPECTED_SHA), backendBody: goodBackendBody() }),
  });
  assert.equal(evidence.verdict, "pass");
  assert.equal(evidence.frontend.ok, true);
  assert.equal(evidence.backend.ok, true);
});

test("only frontend supplied: verification must fail, not pass", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: "",
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({ frontendHtml: htmlWithSha(EXPECTED_SHA), backendBody: goodBackendBody() }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.ok(evidence.errors.some((e) => e.includes("both a frontend URL and a backend URL")));
});

test("only backend supplied: verification must fail, not pass", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: "",
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({ frontendHtml: htmlWithSha(EXPECTED_SHA), backendBody: goodBackendBody() }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.ok(evidence.errors.some((e) => e.includes("both a frontend URL and a backend URL")));
});

test("bad hostname: host outside the allowlist is rejected", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: "https://evil.attacker.example/",
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({ frontendHtml: htmlWithSha(EXPECTED_SHA), backendBody: goodBackendBody() }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.match(evidence.frontend.detail, /not in the approved allowlist/);
});

test("credentials in URL are rejected", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: "https://user:pass@app.example.com/",
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({ frontendHtml: htmlWithSha(EXPECTED_SHA), backendBody: goodBackendBody() }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.match(evidence.frontend.detail, /must not embed credentials/);
});

test("non-HTTPS URL is rejected", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: "http://app.example.com/",
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({ frontendHtml: htmlWithSha(EXPECTED_SHA), backendBody: goodBackendBody() }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.match(evidence.frontend.detail, /must be HTTPS/);
});

test("URL fragment is rejected", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: "https://app.example.com/#foo",
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({ frontendHtml: htmlWithSha(EXPECTED_SHA), backendBody: goodBackendBody() }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.match(evidence.frontend.detail, /must not include a fragment/);
});

test("off-host redirect is rejected", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({
      frontendHtml: htmlWithSha(EXPECTED_SHA),
      frontendUrlOverride: "https://attacker.example/",
      backendBody: goodBackendBody(),
    }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.match(evidence.frontend.detail, /redirected off the approved host/);
});

test("short SHA is rejected even if it prefix-matches", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({
      frontendHtml: htmlWithSha(SHORT_SHA),
      backendBody: goodBackendBody({ git_sha: SHORT_SHA }),
    }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.equal(evidence.frontend.sha, SHORT_SHA);
  assert.equal(evidence.frontend.ok, false);
  assert.equal(evidence.backend.ok, false);
});

test("SHA mismatch (full length, wrong value) fails", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({
      frontendHtml: htmlWithSha(OTHER_SHA),
      backendBody: goodBackendBody({ git_sha: OTHER_SHA, app_version: OTHER_SHA }),
    }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.match(evidence.frontend.detail, /expected=/);
  assert.match(evidence.backend.detail, /git_sha mismatch/);
});

test("missing schema revision fails backend check", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({
      frontendHtml: htmlWithSha(EXPECTED_SHA),
      backendBody: goodBackendBody({ expected_schema_revision: "" }),
    }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.match(evidence.backend.detail, /expected_schema_revision missing/);
});

test("missing app_version fails backend check", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({
      frontendHtml: htmlWithSha(EXPECTED_SHA),
      backendBody: goodBackendBody({ app_version: "" }),
    }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.match(evidence.backend.detail, /app_version missing/);
});

test("app_version must equal expected SHA unless an explicit version map is supplied", async () => {
  const failing = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({
      frontendHtml: htmlWithSha(EXPECTED_SHA),
      backendBody: goodBackendBody({ app_version: "1.2.3" }),
    }),
  });
  assert.equal(failing.verdict, "fail");
  assert.match(failing.backend.detail, /app_version mismatch/);

  const passing = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    versionMap: { [EXPECTED_SHA]: "1.2.3" },
    fetchImpl: fakeFetch({
      frontendHtml: htmlWithSha(EXPECTED_SHA),
      backendBody: goodBackendBody({ app_version: "1.2.3" }),
    }),
  });
  assert.equal(passing.verdict, "pass");
});

test("missing environment fails backend check", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({
      frontendHtml: htmlWithSha(EXPECTED_SHA),
      backendBody: goodBackendBody({ environment: "" }),
    }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.match(evidence.backend.detail, /environment missing/);
});

test("evidence strips query strings from URLs", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: "https://app.example.com/?token=secret",
    backendUrl: "https://api.example.com/?token=secret",
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({ frontendHtml: htmlWithSha(EXPECTED_SHA), backendBody: goodBackendBody() }),
  });
  assert.doesNotMatch(evidence.frontend.url, /token=secret/);
  assert.doesNotMatch(evidence.backend.url, /token=secret/);
});

test("empty allowlist fails closed", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: parseAllowlist(""),
    fetchImpl: fakeFetch({ frontendHtml: htmlWithSha(EXPECTED_SHA), backendBody: goodBackendBody() }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.match(evidence.frontend.detail, /no approved host allowlist configured/);
});

test("uppercase SHA is rejected — full SHA match must be lowercase-exact", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA.toUpperCase(),
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({ frontendHtml: htmlWithSha(EXPECTED_SHA), backendBody: goodBackendBody() }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.ok(evidence.errors.some((e) => e.includes("lowercase")));
});

test("credentials in a rejected URL never reach the evidence file", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: "https://sneaky:hunter2@app.example.com/",
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({ frontendHtml: htmlWithSha(EXPECTED_SHA), backendBody: goodBackendBody() }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.doesNotMatch(evidence.frontend.url, /sneaky/);
  assert.doesNotMatch(evidence.frontend.url, /hunter2/);
  assert.doesNotMatch(JSON.stringify(evidence), /hunter2/);
});

test("HTTPS-to-HTTP downgrade on the same host is rejected", async () => {
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({
      frontendHtml: htmlWithSha(EXPECTED_SHA),
      frontendUrlOverride: "http://app.example.com/",
      backendBody: goodBackendBody(),
    }),
  });
  assert.equal(evidence.verdict, "fail");
  assert.match(evidence.frontend.detail, /redirected off HTTPS/);
});

test("fetch calls are bounded by an abort signal (no unbounded hang)", async () => {
  const recordedOpts = [];
  await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: fakeFetch({
      frontendHtml: htmlWithSha(EXPECTED_SHA),
      backendBody: goodBackendBody(),
      recordedOpts,
    }),
  });
  assert.equal(recordedOpts.length, 2);
  for (const opts of recordedOpts) {
    assert.ok(opts.signal instanceof AbortSignal, "fetch must be called with an AbortSignal");
  }
});

test("a timed-out fetch produces structured failure evidence, not a hang", async () => {
  const timeoutFetch = async () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    throw err;
  };
  const evidence = await verifyRelease({
    expectedSha: EXPECTED_SHA,
    frontendUrl: FRONTEND_URL,
    backendUrl: BACKEND_URL,
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: timeoutFetch,
  });
  assert.equal(evidence.verdict, "fail");
  assert.match(evidence.frontend.detail, /timeout/i);
  assert.match(evidence.backend.detail, /timeout/i);
});
