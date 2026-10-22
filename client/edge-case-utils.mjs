import "dotenv/config";
import { randomUUID } from "node:crypto";

const apiUrl = (process.env.USAGE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

export async function createAccount(name) {
  const response = await fetch(`${apiUrl}/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Account creation failed (${response.status})`);
  return data;
}

export async function createDemoContext(name) {
  let apiKey = process.env.USAGE_API_KEY;
  if (!apiKey) {
    const account = await createAccount(name);
    apiKey = account.apiKey;
    console.log(`Created isolated account: ${account.account.name}`);
  }

  async function call(path, { method = "GET", body, key = apiKey, allowedStatuses = [] } = {}) {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        ...(key ? { "x-api-key": key } : {}),
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

  const currentAssignment = await call("/account/plan", { allowedStatuses: [404] });
  const originalAccountPlan = currentAssignment.data.plan;
  const guardResponse = await call("/plans", {
    method: "POST",
    body: {
      name: `Edge-case account limit ${randomUUID().slice(0, 8)}`,
      type: "account",
      monthlyAllowance: 1_000_000_000,
      maxUnitsPerRequest: 100_000,
    },
  });
  const accountGuard = guardResponse.data.plan;
  await call("/account/plan", { method: "POST", body: { planId: accountGuard.id } });
  const userPlanResponse = await call("/plans", {
    method: "POST",
    body: {
      name: `Edge-case user allowance ${randomUUID().slice(0, 8)}`,
      type: "user",
      monthlyAllowance: 1_000_000_000,
      maxUnitsPerRequest: 100_000,
    },
  });

  return {
    apiKey,
    call,
    userPlan: userPlanResponse.data.plan,
    createUser: async (externalId, planId = userPlanResponse.data.plan.id, key = apiKey) => {
      await call("/users", { method: "POST", body: { externalId }, key });
      if (planId) {
        await call(`/users/${encodeURIComponent(externalId)}/plan`, {
          method: "POST",
          body: { planId },
          key,
        });
      }
    },
    consume: async (externalId, units, requestId = randomUUID(), key = apiKey) =>
      call("/usage/consume", {
        method: "POST",
        body: { externalId, units, requestId },
        key,
        allowedStatuses: [400, 404, 409, 429],
      }),
    restore: async () => {
      if (originalAccountPlan) {
        await call("/account/plan", { method: "POST", body: { planId: originalAccountPlan.id } });
        console.log("Restored the account's original plan assignment.");
      }
    },
  };
}

export function demoExternalId(label) {
  return `${label}-${randomUUID().slice(0, 8)}`;
}
