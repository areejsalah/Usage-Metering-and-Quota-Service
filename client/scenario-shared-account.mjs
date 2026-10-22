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
  const { data } = await call("/accounts", { method: "POST", body: { name: "Shared limited account scenario" } });
  apiKey = data.apiKey;
  console.log(`One shared account created: ${data.account.name}`);
}

try {
  await getAccountKey();
  const suffix = Date.now();
  const users = [`shared-user-a-${suffix}`, `shared-user-b-${suffix}`];
  const { data: { plans } } = await call("/plans");
  const userPlan = plans.find((plan) => plan.name === "Basic" && plan.type === "user");
  if (!userPlan) throw new Error("Basic predefined user plan is missing.");

  for (const externalId of users) {
    await call("/users", { method: "POST", body: { externalId } });
    await call(`/users/${encodeURIComponent(externalId)}/plan`, { method: "POST", body: { planId: userPlan.id } });
  }

  const { data: limitedPlan } = await call("/plans", {
    method: "POST",
    body: { name: `Shared account limit ${suffix}`, type: "account", monthlyAllowance: 10, maxUnitsPerRequest: 10 },
  });
  await call("/account/plan", { method: "POST", body: { planId: limitedPlan.plan.id } });

  console.log("Scenario 3: two users concurrently request 7 units each; the shared account allowance is 10.");
  const results = await Promise.all(users.map(async (externalId) => {
    const result = await call("/usage/consume", {
      method: "POST",
      body: { externalId, units: 7, requestId: randomUUID() },
      statuses: [429],
    });
    console.log(`${externalId}: HTTP ${result.status} ${JSON.stringify(result.data)}`);
    return result;
  }));

  const accepted = results.filter(({ status, data }) => status === 200 && data.status === "ACCEPTED");
  const rejected = results.filter(({ status, data }) => status === 429 && data.status === "REJECTED");
  if (accepted.length !== 1 || rejected.length !== 1) {
    throw new Error(`Expected one accepted request and one rejection; got ${accepted.length} accepted and ${rejected.length} rejected.`);
  }
  console.log(`EXPECTED RESULT: one user consumed 7 units; the other was rejected: ${rejected[0].data.rejectionReason} (scope: ${rejected[0].data.rejectionScope}).`);
} catch (error) {
  console.error(`Scenario failed: ${error.message}`);
  process.exitCode = 1;
}
