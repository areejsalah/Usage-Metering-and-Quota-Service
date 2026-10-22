import "dotenv/config";
import { randomUUID } from "node:crypto";

const apiUrl = (process.env.USAGE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
let apiKey = process.env.USAGE_API_KEY;
const requestIds = [];
const suffix = randomUUID().slice(0, 8);
let originalAccountPlan;

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

async function ensureAccount() {
  if (apiKey) return;
  const { data } = await call("/accounts", {
    method: "POST",
    body: { name: `Plan changes demo ${suffix}` },
  });
  apiKey = data.apiKey;
  console.log(`Created isolated account: ${data.account.name}`);
}

async function createUser(label, planId, externalId = `${label}-${suffix}`) {
  await call("/users", { method: "POST", body: { externalId } });
  await call(`/users/${encodeURIComponent(externalId)}/plan`, {
    method: "POST",
    body: { planId },
  });
  return externalId;
}

async function createPlan(name, type, monthlyAllowance, maxUnitsPerRequest = 100) {
  const { data } = await call("/plans", {
    method: "POST",
    body: { name: `${name} ${suffix}`, type, monthlyAllowance, maxUnitsPerRequest },
  });
  return data.plan;
}

async function updatePlan(plan, fields) {
  const { data } = await call(`/plans/${plan.id}`, { method: "PATCH", body: fields });
  console.log(`Plan updated: ${data.plan.name}; allowance=${data.plan.monthlyAllowance}, max/request=${data.plan.maxUnitsPerRequest}`);
  return data.plan;
}

async function assignAccountPlan(plan) {
  await call("/account/plan", { method: "POST", body: { planId: plan.id } });
  console.log(`Assigned account plan: ${plan.name} (monthly allowance ${plan.monthlyAllowance}).`);
}

async function consume(label, externalId, units, expectedStatus) {
  const requestId = `${label}-${randomUUID()}`;
  requestIds.push(requestId);
  const result = await call("/usage/consume", {
    method: "POST",
    body: { externalId, units, requestId },
    allowedStatuses: [429],
  });
  console.log(`${label}: HTTP ${result.status} ${JSON.stringify(result.data)}`);
  if (result.status !== expectedStatus) {
    throw new Error(`${label}: expected HTTP ${expectedStatus}, got ${result.status}.`);
  }
  return result.data;
}

async function showUserUsage(label, externalId) {
  const { data } = await call(`/users/${encodeURIComponent(externalId)}/usage`);
  console.log(`${label}: consumed=${data.consumedUnits}, allowance=${data.monthlyAllowance}, remaining=${data.remainingUnits}.`);
  return data;
}

async function showUserPlan(label, externalId) {
  const { data } = await call(`/users/${encodeURIComponent(externalId)}/plan`);
  console.log(`${label}: current user plan is ${data.plan.name}.`);
}

try {
  await ensureAccount();
  const originalAssignment = await call("/account/plan", { allowedStatuses: [404] });
  originalAccountPlan = originalAssignment.data.plan;

  // Keep the account-level limit high while demonstrating user plan changes.
  // Plan allowances are stored in a PostgreSQL INTEGER, so keep this below 2^31 - 1.
  const accountGuard = await createPlan("Demo account guard", "account", 1_000_000_000);
  await assignAccountPlan(accountGuard);
  const baseUserPlan = await createPlan("Demo standard user", "user", 1_000, 100);

  console.log("\nCASE 1 — Plan updates govern requests made after the update");
  const updateUser = await createUser("plan-update-user", baseUserPlan.id);
  const updatePlanDemo = await createPlan("Updateable user plan", "user", 10, 10);
  await call(`/users/${encodeURIComponent(updateUser)}/plan`, { method: "POST", body: { planId: updatePlanDemo.id } });
  await consume("before-plan-update", updateUser, 5, 200);
  await updatePlan(updatePlanDemo, { monthlyAllowance: 4 });
  await showUserPlan("After successful update", updateUser);
  await showUserUsage("Usage after update", updateUser);
  const updateRejection = await consume("after-plan-update", updateUser, 1, 429);
  console.log(`Confirmed: new request rejected with ${updateRejection.rejectionReason} (${updateRejection.rejectionScope}).`);

  console.log("\nCASE 2 — Updating an assigned account plan affects consumption by its users");
  const currentAccount = await call("/account/usage");
  const accountUsageBefore = currentAccount.data.consumedUnits;
  const accountPlan = await createPlan("Shared account allowance", "account", accountUsageBefore + 20, 100);
  await assignAccountPlan(accountPlan);
  const accountUserA = await createUser("account-plan-user-a", baseUserPlan.id);
  const accountUserB = await createUser("account-plan-user-b", baseUserPlan.id);
  await consume("account-user-a", accountUserA, 10, 200);
  await updatePlan(accountPlan, { monthlyAllowance: accountUsageBefore + 10 });
  const accountUsage = await call("/account/usage");
  console.log(`Shared account usage: ${accountUsage.data.consumedUnits}/${accountUsage.data.monthlyAllowance}; ${accountUsage.data.remainingUnits} remaining.`);
  const accountRejection = await consume("account-user-b", accountUserB, 1, 429);
  console.log(`Confirmed: another assigned user is blocked by the account plan: ${accountRejection.rejectionReason} (${accountRejection.rejectionScope}).`);
  await assignAccountPlan(accountGuard);

  console.log("\nCASE 3 — Switching plans preserves units already used this month");
  const switchPlanA = await createPlan("Switch source plan", "user", 10, 10);
  const switchPlanB = await createPlan("Switch destination plan", "user", 10, 10);
  const switchUser = await createUser("switch-plan-user", switchPlanA.id);
  await consume("before-plan-switch", switchUser, 6, 200);
  await call(`/users/${encodeURIComponent(switchUser)}/plan`, { method: "POST", body: { planId: switchPlanB.id } });
  await showUserPlan("After switch", switchUser);
  const switchedUsage = await showUserUsage("Usage after switch", switchUser);
  if (switchedUsage.consumedUnits !== 6) throw new Error("Plan switch unexpectedly reset consumed units.");
  const switchRejection = await consume("after-plan-switch", switchUser, 5, 429);
  console.log(`Confirmed: usage was preserved and the request was rejected with ${switchRejection.rejectionReason}.`);

  console.log("\nCASE 4 — Reducing allowance below usage reports zero remaining and rejects more usage");
  const reducedPlan = await createPlan("Reducible user plan", "user", 10, 10);
  const reducedUser = await createUser("reduced-allowance-user", reducedPlan.id);
  await consume("before-allowance-reduction", reducedUser, 8, 200);
  await updatePlan(reducedPlan, { monthlyAllowance: 5 });
  const reducedUsage = await showUserUsage("After lowering allowance below consumption", reducedUser);
  if (reducedUsage.remainingUnits !== 0) throw new Error("Expected zero remaining allowance after reduction.");
  const zeroRemainingRejection = await consume("zero-remaining", reducedUser, 1, 429);
  console.log(`Confirmed: ${zeroRemainingRejection.rejectionReason}.`);
  await updatePlan(reducedPlan, { monthlyAllowance: 9 });
  await showUserUsage("After making one unit available", reducedUser);
  await consume("after-allowance-available", reducedUser, 1, 200);

  console.log("\nREQUEST HISTORY — Confirm pre-change and post-change requests remain recorded");
  const { data: history } = await call("/usage/history?limit=100&offset=0");
  const recordedIds = new Set(history.requests.map((request) => request.requestId));
  const missingIds = requestIds.filter((id) => !recordedIds.has(id));
  for (const request of history.requests.filter((item) => requestIds.includes(item.requestId))) {
    console.log(`${request.createdAt} | ${request.status} | ${request.units} unit(s) | ${request.requestId}${request.rejectionReason ? ` | ${request.rejectionReason} (${request.rejectionScope})` : ""}`);
  }
  if (missingIds.length) throw new Error(`Request history did not contain ${missingIds.length} scenario request(s).`);
  console.log(`History preserved: all ${requestIds.length} scenario requests remain recorded.`);
} catch (error) {
  console.error(`Plan-change scenario failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (originalAccountPlan && apiKey) {
    try {
      await assignAccountPlan(originalAccountPlan);
      console.log("Restored the account's original plan assignment.");
    } catch (error) {
      console.error(`Could not restore the original account plan: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
