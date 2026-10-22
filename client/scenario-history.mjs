import "dotenv/config";
import { randomUUID } from "node:crypto";

const apiUrl = (process.env.USAGE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
let apiKey = process.env.USAGE_API_KEY;
let externalId = process.argv[2] ?? process.env.DEMO_EXTERNAL_USER_ID;

async function call(path, { method = "GET", body, allowedStatuses = [] } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && !allowedStatuses.includes(response.status)) {
    throw new Error(data.error ?? `${method} ${path} failed (${response.status})`);
  }
  return { status: response.status, data };
}

async function setupSampleData() {
  const { data: account } = await call("/accounts", {
    method: "POST",
    body: { name: "Usage history demo account" },
  });
  apiKey = account.apiKey;
  console.log(`Created sample account: ${account.account.name}`);

  externalId ??= `history-user-${Date.now()}`;
  const { data: user } = await call("/users", {
    method: "POST",
    body: { externalId },
  });

  const { data: plansData } = await call("/plans");
  const accountPlan = plansData.plans.find((plan) => plan.name === "Starter" && plan.type === "account");
  if (!accountPlan) throw new Error("Starter predefined account plan is missing.");
  await call("/account/plan", { method: "POST", body: { planId: accountPlan.id } });

  const { data: userPlanData } = await call("/plans", {
    method: "POST",
    body: { name: "History demo user plan", type: "user", monthlyAllowance: 1, maxUnitsPerRequest: 10 },
  });
  await call(`/users/${encodeURIComponent(externalId)}/plan`, {
    method: "POST",
    body: { planId: userPlanData.plan.id },
  });

  const accepted = await call("/usage/consume", {
    method: "POST",
    body: { externalId, units: 1, requestId: randomUUID() },
    allowedStatuses: [429],
  });
  const rejected = await call("/usage/consume", {
    method: "POST",
    body: { externalId, units: 2, requestId: randomUUID() },
    allowedStatuses: [429],
  });
  console.log(`Seeded sample requests for user record ${user.user.id}: ${accepted.data.status}, ${rejected.data.status}.`);
}

function previousMonth(offset) {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - offset);
  return date.toISOString().slice(0, 7);
}

try {
  if (!apiKey) {
    await setupSampleData();
  } else if (!externalId) {
    throw new Error("Pass a user external ID: npm run demo:history -- <external-user-id>");
  }

  console.log(`\nHistorical monthly usage for ${externalId}`);
  for (let offset = 1; offset <= 3; offset += 1) {
    const month = previousMonth(offset);
    const result = await call(
      `/users/${encodeURIComponent(externalId)}/usage?month=${month}`,
      { allowedStatuses: [404] },
    );
    if (result.status === 404) {
      console.log(`${month}: no usage summary available (${result.data.error}).`);
    } else {
      console.log(`${month}: ${result.data.consumedUnits}/${result.data.monthlyAllowance} units consumed; ${result.data.remainingUnits} remaining.`);
    }
  }

  console.log("\nRecent account request outcomes (newest first)");
  const { data: history } = await call("/usage/history?limit=100&offset=0");
  if (history.requests.length === 0) {
    console.log("No usage requests have been recorded for this account.");
  } else {
    for (const request of history.requests) {
      const reason = request.rejectionReason ? `; reason: ${request.rejectionReason}; scope: ${request.rejectionScope}` : "";
      console.log(`${request.createdAt} | ${request.status} | ${request.units} unit(s) | request ${request.requestId}${reason}`);
    }
  }
} catch (error) {
  console.error(`History scenario failed: ${error.message}`);
  process.exitCode = 1;
}
