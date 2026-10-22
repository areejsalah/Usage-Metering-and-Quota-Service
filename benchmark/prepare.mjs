import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3100";
const targetPath = fileURLToPath(new URL("./benchmark-target.json", import.meta.url));

if (process.env.BENCHMARK_CONFIRM_DISPOSABLE !== "true") {
  throw new Error("Set BENCHMARK_CONFIRM_DISPOSABLE=true to confirm this is the disposable benchmark stack.");
}

const targetUrl = new URL(baseUrl);
if (targetUrl.hostname !== "localhost" || targetUrl.port !== "3100") {
  throw new Error("For safety, preparation only accepts the isolated benchmark API at http://localhost:3100.");
}

async function request(route, { method = "GET", apiKey, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${route} returned non-JSON HTTP ${response.status}: ${text}`);
  }
  if (!response.ok) {
    throw new Error(`${method} ${route} returned HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

const health = await request("/health");
if (health?.status !== "ok") throw new Error("Benchmark API health check returned an unexpected response.");

const runId = randomUUID();
const externalId = `k6-${runId}`;
const accountResult = await request("/accounts", {
  method: "POST",
  body: { name: `k6 benchmark ${runId}` },
});
const apiKey = accountResult?.apiKey;
if (!apiKey) throw new Error("Account creation did not return an API key.");

async function createPlan(type) {
  const result = await request("/plans", {
    method: "POST",
    apiKey,
    body: {
      name: `k6 benchmark ${type} ${runId}`,
      type,
      monthlyAllowance: 1_000_000,
      maxUnitsPerRequest: 100_000,
    },
  });
  if (!result?.plan?.id) throw new Error(`Creating the ${type} plan returned no plan ID.`);
  return result.plan.id;
}

const accountPlanId = await createPlan("account");
const userPlanId = await createPlan("user");
await request("/users", { method: "POST", apiKey, body: { externalId } });
await request("/account/plan", { method: "POST", apiKey, body: { planId: accountPlanId } });
await request(`/users/${encodeURIComponent(externalId)}/plan`, {
  method: "POST",
  apiKey,
  body: { planId: userPlanId },
});

await writeFile(targetPath, `${JSON.stringify({ baseUrl, apiKey, externalId, runId }, null, 2)}\n`, { mode: 0o600 });
console.log(`Prepared a fresh benchmark account and user for run ${runId}.`);
console.log(`Private target credentials saved to ${targetPath}; this file is git-ignored.`);
