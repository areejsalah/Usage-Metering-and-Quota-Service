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
  const { data } = await call("/accounts", { method: "POST", body: { name: "Success scenario" } });
  apiKey = data.apiKey;
  console.log(`Account created: ${data.account.name}`);
}

try {
  await getAccountKey();
  const externalId = `success-user-${Date.now()}`;
  await call("/users", { method: "POST", body: { externalId } });
  const { data: { plans } } = await call("/plans");
  const accountPlan = plans.find((plan) => plan.name === "Starter" && plan.type === "account");
  const userPlan = plans.find((plan) => plan.name === "Basic" && plan.type === "user");
  if (!accountPlan || !userPlan) throw new Error("Starter or Basic predefined plan is missing.");

  await call("/account/plan", { method: "POST", body: { planId: accountPlan.id } });
  await call(`/users/${encodeURIComponent(externalId)}/plan`, { method: "POST", body: { planId: userPlan.id } });

  console.log("Scenario 1: user consumes units successfully");
  const result = await call("/usage/consume", {
    method: "POST",
    body: { externalId, units: 25, requestId: randomUUID() },
    statuses: [429],
  });
  console.log(`HTTP ${result.status}: ${JSON.stringify(result.data, null, 2)}`);
  if (result.status !== 200) throw new Error("Expected the request to be accepted.");
  console.log(`SUCCESS: ${externalId} consumed ${result.data.units} units.`);
} catch (error) {
  console.error(`Scenario failed: ${error.message}`);
  process.exitCode = 1;
}
