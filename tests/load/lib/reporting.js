// Shared handleSummary() implementation. Each profile script imports
// buildHandleSummary() and exports it as `handleSummary`, passing its own
// profile name and whether it includes AI-backed requests.
//
// Produces:
//   tests/load/results/<profile>-<runId>.json   (machine-readable)
//   tests/load/results/<profile>-<runId>.md      (human-readable)
// and still prints the default k6 stdout summary.

function percentile(metrics, name, p) {
  const metric = metrics[name];
  if (!metric || !metric.values) return null;
  const key = `p(${p})`;
  return metric.values[key] ?? null;
}

function metricValue(metrics, name, field) {
  const metric = metrics[name];
  if (!metric || !metric.values) return null;
  return metric.values[field] ?? null;
}

function statusDistribution(metrics) {
  // k6 does not natively give a status-code histogram in the summary object;
  // profile scripts that care about this should tag responses and export a
  // Counter per status bucket (see profile scripts for `http_status_2xx`,
  // `http_status_4xx`, `http_status_5xx`, `http_status_429`). Absent that,
  // report what's derivable from the built-in metrics.
  const dist = {};
  for (const key of ["http_status_2xx", "http_status_4xx", "http_status_5xx", "http_status_429"]) {
    const count = metricValue(metrics, key, "count");
    if (count !== null) dist[key] = count;
  }
  return dist;
}

function collectThresholdBreaches(data) {
  const breaches = [];
  for (const [metricName, metric] of Object.entries(data.metrics || {})) {
    const thresholds = metric.thresholds || {};
    for (const [expression, result] of Object.entries(thresholds)) {
      const failed = typeof result === "object" ? result.ok === false : result === false;
      if (failed) {
        breaches.push({ metric: metricName, threshold: expression });
      }
    }
  }
  return breaches;
}

export function buildHandleSummary({ profile, includesAi = false }) {
  return function handleSummary(data) {
    const runId = __ENV.LOAD_TEST_RUN_ID || "unknown-run";
    const environment = __ENV.LOAD_TEST_ENVIRONMENT_LABEL || "unspecified";
    const gitSha = __ENV.LOAD_TEST_GIT_SHA || "unknown";
    const target = __ENV.BACKEND_URL || "unknown";

    const metrics = data.metrics || {};
    const breaches = collectThresholdBreaches(data);

    const report = {
      test_date: new Date().toISOString(),
      git_sha: gitSha,
      environment,
      target,
      profile,
      run_id: runId,
      includes_ai: includesAi,
      duration_seconds: data.state ? data.state.testRunDurationMs / 1000 : null,
      user_concurrency: {
        max_vus: metricValue(metrics, "vus_max", "value"),
      },
      request_count: metricValue(metrics, "http_reqs", "count"),
      requests_per_second: metricValue(metrics, "http_reqs", "rate"),
      latency_ms: {
        p50: percentile(metrics, "http_req_duration", "50"),
        p95: percentile(metrics, "http_req_duration", "95"),
        p99: percentile(metrics, "http_req_duration", "99"),
      },
      error_rate: metricValue(metrics, "http_req_failed", "rate"),
      http_status_distribution: statusDistribution(metrics),
      ai_latency_ms: includesAi
        ? {
            first_token_p95: percentile(metrics, "chat_first_token_ms", "95"),
            completion_p95: percentile(metrics, "chat_completion_ms", "95"),
          }
        : null,
      threshold_breaches: breaches,
      bottleneck: __ENV.LOAD_TEST_BOTTLENECK_NOTE || null,
      recommended_safe_operating_limit: __ENV.LOAD_TEST_SAFE_LIMIT_NOTE || null,
      _note:
        "bottleneck and recommended_safe_operating_limit are not computed automatically — " +
        "an operator fills these in after reviewing the run (set LOAD_TEST_BOTTLENECK_NOTE / " +
        "LOAD_TEST_SAFE_LIMIT_NOTE, or edit the generated report directly). Do not treat a blank " +
        "value here as 'no bottleneck found' — it means nobody has analyzed the run yet.",
    };

    const jsonPath = `tests/load/results/${profile}-${runId}.json`;
    const mdPath = `tests/load/results/${profile}-${runId}.md`;

    const md = [
      `# Load test report — ${profile}`,
      "",
      `- **Test date:** ${report.test_date}`,
      `- **Git SHA:** ${report.git_sha}`,
      `- **Environment:** ${report.environment}`,
      `- **Target:** ${report.target}`,
      `- **Run ID:** ${report.run_id}`,
      `- **Duration:** ${report.duration_seconds ?? "n/a"} s`,
      `- **Max VUs:** ${report.user_concurrency.max_vus ?? "n/a"}`,
      `- **Requests:** ${report.request_count ?? "n/a"} (${report.requests_per_second?.toFixed?.(2) ?? "n/a"} req/s)`,
      `- **Latency p50/p95/p99 (ms):** ${report.latency_ms.p50 ?? "n/a"} / ${report.latency_ms.p95 ?? "n/a"} / ${report.latency_ms.p99 ?? "n/a"}`,
      `- **Error rate:** ${report.error_rate !== null ? (report.error_rate * 100).toFixed(3) + "%" : "n/a"}`,
      "",
      "## Threshold breaches",
      breaches.length === 0
        ? "None — all configured k6 thresholds (which encode the SLO targets from docs/SLO.md) passed."
        : breaches.map((b) => `- **${b.metric}**: ${b.threshold}`).join("\n"),
      "",
      "## Bottleneck / safe operating limit",
      "**Not filled in automatically — requires operator analysis of this run.**",
      `- Bottleneck: ${report.bottleneck ?? "_(not yet analyzed)_"}`,
      `- Recommended safe operating limit: ${report.recommended_safe_operating_limit ?? "_(not yet analyzed)_"}`,
      "",
    ].join("\n");

    const stdout = {
      "stdout": JSON.stringify(
        {
          summary: `${profile}: ${report.request_count} reqs, ${report.error_rate !== null ? (report.error_rate * 100).toFixed(2) : "?"}% errors, p95=${report.latency_ms.p95}ms, breaches=${breaches.length}`,
        },
        null,
        2,
      ) + "\n",
    };

    return Object.assign(stdout, {
      [jsonPath]: JSON.stringify(report, null, 2),
      [mdPath]: md,
    });
  };
}
