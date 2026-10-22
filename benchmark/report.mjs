import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const resultsPath = fileURLToPath(new URL("../benchmark-results.json", import.meta.url));
const targetPath = fileURLToPath(new URL("./benchmark-target.json", import.meta.url));
const outputPath = fileURLToPath(new URL("../benchmark-results.md", import.meta.url));
const stages = [
  { name: "stage_25_rps", rate: 25, expected: 750 },
  { name: "stage_100_rps", rate: 100, expected: 3_000 },
  { name: "stage_500_rps", rate: 500, expected: 15_000 },
];

const raw = await readFile(resultsPath, "utf8");
const points = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter((item) => item.type === "Point");
const target = JSON.parse(await readFile(targetPath, "utf8"));

function values(metric, stage) {
  return points.filter((point) => point.metric === metric && point.data?.tags?.scenario === stage)
    .map((point) => point.data.value);
}

function percentile(samples, fraction) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

function fixed(value, digits = 2) {
  return value === null || value === undefined ? "n/a" : Number(value).toFixed(digits);
}

async function api(route, { method = "GET", body } = {}) {
  const response = await fetch(`${target.baseUrl}${route}`, {
    method,
    headers: {
      "x-api-key": target.apiKey,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function readBenchmarkHistory() {
  const requests = [];
  let offset = 0;
  for (;;) {
    const page = await api(`/usage/history?limit=100&offset=${offset}`);
    if (page.status !== 200 || !Array.isArray(page.payload?.requests)) {
      throw new Error(`Usage history page at offset ${offset} could not be read.`);
    }
    requests.push(...page.payload.requests);
    if (page.payload.requests.length < 100) break;
    offset += page.payload.requests.length;
  }
  return requests.filter((request) => request.requestId.startsWith(`k6-${target.runId}-stage_`));
}

const reports = stages.map((stage) => {
  const durations = values("http_req_duration", stage.name);
  const responses = values("http_reqs", stage.name).length;
  const errors = values("benchmark_errors", stage.name).reduce((sum, n) => sum + n, 0);
  const iterations = values("benchmark_iterations", stage.name).reduce((sum, n) => sum + n, 0);
  const dropped = values("dropped_iterations", stage.name).reduce((sum, n) => sum + n, 0);
  return {
    ...stage,
    responses,
    iterations,
    errors,
    dropped,
    accepted: 0,
    rejected: 0,
    acceptedUnits: 0,
    throughput: 0,
    errorRate: responses ? errors / responses : null,
    avg: durations.length ? durations.reduce((sum, n) => sum + n, 0) / durations.length : null,
    p50: percentile(durations, 0.50),
    p95: percentile(durations, 0.95),
    p99: percentile(durations, 0.99),
    passed: false,
  };
});

const quotaProbeId = `k6-${target.runId}-quota-probe`;
const quotaProbe = await api("/usage/consume", {
  method: "POST",
  body: { externalId: target.externalId, units: 100_001, requestId: quotaProbeId },
});
const history = await readBenchmarkHistory();
for (const report of reports) {
  const stagePrefix = `k6-${target.runId}-${report.name}-`;
  const stageRequests = history.filter((request) => request.requestId.startsWith(stagePrefix));
  const acceptedRequests = stageRequests.filter((request) => request.status === "ACCEPTED");
  report.accepted = acceptedRequests.length;
  report.rejected = stageRequests.filter((request) => request.status === "REJECTED").length;
  report.acceptedUnits = acceptedRequests.reduce((sum, request) => sum + Number(request.units), 0);
  report.throughput = report.accepted / 30;
  report.passed = report.iterations >= report.expected && report.dropped === 0 &&
    report.accepted + report.rejected === stageRequests.length && report.rejected === 0 &&
    report.errors === 0 && report.accepted >= report.expected && report.accepted <= report.expected + 1;
}

const usageAfterProbe = {
  account: await api("/account/usage"),
  user: await api(`/users/${encodeURIComponent(target.externalId)}/usage`),
};
const acceptedTotal = reports.reduce((sum, report) => sum + report.accepted, 0);
const expectedUsage = history.filter((request) => request.status === "ACCEPTED")
  .reduce((sum, request) => sum + Number(request.units), 0);
const accountConsumed = usageAfterProbe.account.payload?.consumedUnits;
const userConsumed = usageAfterProbe.user.payload?.consumedUnits;
const usageMatches = accountConsumed === expectedUsage && userConsumed === expectedUsage && acceptedTotal === expectedUsage;
const quotaCorrect = quotaProbe.status === 429 && quotaProbe.payload?.status === "REJECTED" && accountConsumed === expectedUsage && userConsumed === expectedUsage;

const lines = [
  "# k6 Performance Benchmark Results",
  "",
  `Run ID: \`${target.runId}\`  `,
  `Target: \`${target.baseUrl}\` (isolated benchmark Compose stack)  `,
  "Scenario: fresh account and user, one unit per request; no historical usage was seeded.",
  "",
  "| Stage | Target rate | Iterations started | HTTP samples | Accepted in history | Rejected in history | k6 errors | Dropped iterations | Accepted throughput | k6 error rate | Avg latency | p50 | p95 | p99 | Result |",
  "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ...reports.map((report) => `| ${report.rate} RPS | ${report.rate}/s | ${report.iterations} | ${report.responses} | ${report.accepted} | ${report.rejected} | ${report.errors} | ${report.dropped} | ${fixed(report.throughput)} req/s | ${report.errorRate === null ? "n/a" : `${fixed(report.errorRate * 100)}%`} | ${fixed(report.avg)} ms | ${fixed(report.p50)} ms | ${fixed(report.p95)} ms | ${fixed(report.p99)} ms | ${report.passed ? "Passed" : "Failed / limited"} |`),
  "",
  "## Usage and quota verification",
  "",
  `- Persisted accepted benchmark requests: ${acceptedTotal}; expected consumed units from accepted history rows: ${expectedUsage}.`,
  `- Actual account consumed units: ${accountConsumed ?? "unavailable"}; actual user consumed units: ${userConsumed ?? "unavailable"}.`,
  `- Usage total matches expected accepted usage: **${usageMatches ? "yes" : "no"}**.`,
  `- Over-limit probe (100,001 units; limit 100,000): HTTP ${quotaProbe.status}, ${quotaProbe.payload?.status ?? "no status"}; it did not increment usage: **${quotaCorrect ? "yes" : "no"}**.`,
  "",
  "Accepted throughput is persisted accepted requests from each 30-second stage divided by its arrival window. Accepted/rejected counts come from paginated usage history, so requests processed by the API after a client timeout are still reconciled. k6 errors and error rate describe load-generator-observed unexpected responses and transport errors, including timeouts; a timed-out request can still appear as accepted in server history if the API finished it. Quota rejections are reported separately. Latency percentiles use the raw `http_req_duration` samples (nearest-rank percentile). Dropped iterations are arrivals k6 could not start.",
  "",
  `Raw k6 JSON output: [benchmark-results.json](benchmark-results.json). It contains per-sample metric points.`,
  "",
  "This report describes one benchmark run on the recorded environment. Results depend on machine, database, and workload conditions.",
  "",
];

await writeFile(outputPath, lines.join("\n"));
console.log(`Wrote ${outputPath}`);
for (const report of reports) {
  console.log(`${report.rate} RPS stage: ${report.passed ? "passed" : "failed/limited"}; ${report.iterations} iterations, ${report.accepted} accepted, ${report.rejected} rejected, ${report.errors} errors, ${report.dropped} dropped.`);
}
console.log(`Quota probe ${quotaCorrect ? "passed" : "failed"}; actual account/user usage ${accountConsumed ?? "unavailable"}/${userConsumed ?? "unavailable"}, expected ${expectedUsage}.`);

if (reports.some((report) => !report.passed) || !usageMatches || !quotaCorrect) process.exitCode = 1;
