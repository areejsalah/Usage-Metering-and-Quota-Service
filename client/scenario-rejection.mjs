import "dotenv/config";
import { randomUUID } from "node:crypto";

const apiUrl = (process.env.USAGE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
let apiKey = process.env.USAGE_API_KEY;

async function call(path, { method = "GET", body, statuses = [] } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { ...(apiKey ? { "x-api-key": apiKey } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && !statuses.includes(response.status)) throw new Error(data.error ?? `${method} ${path} failed (${response.status})`);
  return { status: response.status, data };
}

async function getAccountKey() {
  if (apiKey) return;
  const { data } = await call("/accounts", { method: "POST", body: { name: "Rejection scenario" } });
  apiKey = data.apiKey;
  console.log(`Account created: ${data.account.name}`);
}

try {
  await getAccountKey();
  const externalId = `rejection-user-${Date.now()}`;
  await call("/users", { method: "POST", body: { externalId } });
  const { data: { plans } } = await call("/plans");
  const accountPlan = plans.find((plan) => plan.name === "Starter" && plan.type === "account");
  if (!accountPlan) throw new Error("Starter predefined account plan is missing.");
  await call("/account/plan", { method: "POST", body: { planId: accountPlan.id } });

  const { data: created } = await call("/plans", {
    method: "POST",
    body: { name: `Tight user allowance ${Date.now()}`, type: "user", monthlyAllowance: 2, maxUnitsPerRequest: 10 },
  });
  await call(`/users/${encodeURIComponent(externalId)}/plan`, { method: "POST", body: { planId: created.plan.id } });

  console.log("Scenario 2: user exceeds the monthly allowance");
  const result = await call("/usage/consume", {
    method: "POST",
    body: { externalId, units: 5, requestId: randomUUID() },
    statuses: [429],
  });
  console.log(`HTTP ${result.status}: ${JSON.stringify(result.data, null, 2)}`);
  if (result.status !== 429 || result.data.status !== "REJECTED") throw new Error("Expected a quota rejection.");
  console.log(`EXPECTED REJECTION: ${result.data.rejectionReason} (scope: ${result.data.rejectionScope}).`);
} catch (error) {
  console.error(`Scenario failed: ${error.message}`);
  process.exitCode = 1;
}
