import "dotenv/config";
import { randomUUID } from "node:crypto";

const apiUrl = (process.env.USAGE_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
let apiKey = process.env.USAGE_API_KEY;
const externalId = process.argv[2] ?? process.env.DEMO_EXTERNAL_USER_ID;
const documentText = process.argv.slice(3).join(" ");

if (!externalId || !documentText) {
  console.error('Usage: npm run demo -- <external-user-id> "<document text>"');
  process.exit(1);
}

async function api(path, { method = "GET", body, allowConflict = false, allowedStatuses = [] } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok && !(allowConflict && response.status === 409) && !allowedStatuses.includes(response.status)) {
    const message = data.error ?? `Request failed (${response.status})`;
    throw new Error(`${method} ${path}: ${message}`);
  }

  return { status: response.status, data };
}

async function ensureAccountKey() {
  if (apiKey) return;

  const response = await fetch(`${apiUrl}/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: process.env.DEMO_ACCOUNT_NAME ?? "Usage demo account" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.apiKey !== "string") {
    throw new Error(data.error ?? `Could not create demo account (${response.status})`);
  }
  apiKey = data.apiKey;
  console.log(`Created demo account ${data.account.name} and received its API key.`);
}

async function ensureUser() {
  const result = await api("/users", {
    method: "POST",
    body: { externalId },
    allowConflict: true,
  });
  if (result.status === 201) console.log(`Created service user ${externalId}.`);
}

async function ensurePlan(path, planType, planName) {
 const current = await api(path, { allowedStatuses: [404] });
  if (current.status === 200) return;

  const { data } = await api("/plans");
  const plan = data.plans.find((candidate) => candidate.type === planType && candidate.name === planName);
  if (!plan) throw new Error(`The predefined ${planName} ${planType} plan was not found.`);

  const assignmentPath = planType === "account" ? "/account/plan" : `/users/${encodeURIComponent(externalId)}/plan`;
  await api(assignmentPath, { method: "POST", body: { planId: plan.id } });
  console.log(`Assigned ${planName} ${planType} plan.`);
}

try {
  await ensureAccountKey();
  await ensureUser();
  await ensurePlan("/account/plan", "account", "Starter");
  await ensurePlan(`/users/${encodeURIComponent(externalId)}/plan`, "user", "Basic");

  // Simulate document processing at one unit per 100 characters, rounded up.
  const units = Math.max(1, Math.ceil(documentText.length / 100));
  const { status, data } = await api("/usage/consume", {
    method: "POST",
    body: { externalId, units, requestId: randomUUID() },
    allowedStatuses: [429],
  });

  if (status === 429 || data.status === "REJECTED") {
    console.log(`Not processed: ${data.rejectionReason ?? "usage limit reached"}.`);
    process.exitCode = 2;
  } else {
    console.log(`Simulated document processing complete for ${externalId}.`);
    console.log(`Metered ${data.units} unit(s); user usage is ${data.userConsumed}.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
