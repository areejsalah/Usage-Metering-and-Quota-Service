
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

const CONCURRENCY = 25;
const TOTAL_REQUESTS = 10000;
const UNITS_PER_REQUEST = 1;

async function request(path, { apiKey, method = "GET", body } = {}) {
  const headers = {};

  if (apiKey) headers["x-api-key"] = apiKey;

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readJson(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON; HTTP ${response.status}: ${text}`);
  }
}

async function createAccount(name) {
  const response = await request("/accounts", {
    method: "POST",
    body: { name },
  });

  const data = await readJson(response);

  if (response.status !== 201 || !data.apiKey) {
    throw new Error(`Account creation failed: ${JSON.stringify(data)}`);
  }

  return { ...data.account, apiKey: data.apiKey };
}

async function createPlan(apiKey, name, type, monthlyAllowance, maxUnitsPerRequest) {
  const response = await request("/plans", {
    apiKey,
    method: "POST",
    body: { name, type, monthlyAllowance, maxUnitsPerRequest },
  });

  const data = await readJson(response);

  if (response.status !== 201 || !data.plan?.id) {
    throw new Error(`Plan creation failed: ${JSON.stringify(data)}`);
  }

  return data.plan;
}

async function assignPlan(path, apiKey, planId) {
  const response = await request(path, {
    apiKey,
    method: "POST",
    body: { planId },
  });

  const data = await readJson(response);

  if (response.status !== 201) {
    throw new Error(`Plan assignment failed: ${JSON.stringify(data)}`);
  }
}

async function main() {
  const healthResponse = await request("/health");

  if (!healthResponse.ok) {
    throw new Error(`Health check failed: HTTP ${healthResponse.status}`);
  }

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  console.log("Preparing isolated load-test account...");

  const account = await createAccount(`Load Test ${suffix}`);

  const accountPlan = await createPlan(
    account.apiKey,
    `Load Account Plan ${suffix}`,
    "account",
    1000000,
    1000,
  );

  const userPlan = await createPlan(
    account.apiKey,
    `Load User Plan ${suffix}`,
    "user",
    1000000,
    1000,
  );

  await assignPlan("/account/plan", account.apiKey, accountPlan.id);

  const userResponse = await request("/users", {
    apiKey: account.apiKey,
    method: "POST",
    body: { externalId: `load-user-${suffix}` },
  });

  const userData = await readJson(userResponse);

  if (userResponse.status !== 201 || !userData.user?.externalId) {
    throw new Error(`User creation failed: ${JSON.stringify(userData)}`);
  }

  const externalId = userData.user.externalId;

  await assignPlan(
    `/users/${encodeURIComponent(externalId)}/plan`,
    account.apiKey,
    userPlan.id,
  );

  console.log(`Sending ${TOTAL_REQUESTS} requests with concurrency ${CONCURRENCY}...`);

  const latencies = [];
  let accepted = 0;
  let rejected = 0;
  let errors = 0;
  let nextIndex = 0;

  const startedAt = performance.now();

  async function worker() {
    while (true) {
      const index = nextIndex++;

      if (index >= TOTAL_REQUESTS) return;

      const requestStartedAt = performance.now();

      try {
        const response = await request("/usage/consume", {
          apiKey: account.apiKey,
          method: "POST",
          body: {
            externalId,
            units: UNITS_PER_REQUEST,
            requestId: `load-${suffix}-${index}`,
          },
        });

        const data = await readJson(response);

        latencies.push(performance.now() - requestStartedAt);

        if (response.status === 200 && data.status === "ACCEPTED") {
          accepted++;
        } else {
          rejected++;
          console.error(`Rejected request ${index}: HTTP ${response.status}`);
        }
      } catch (error) {
        errors++;
        console.error(`Request ${index} failed:`, error.message);
      }
    }
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => worker()),
  );

  const durationMs = performance.now() - startedAt;
  latencies.sort((a, b) => a - b);

  function percentile(p) {
    if (latencies.length === 0) return null;
    return latencies[Math.ceil(p * latencies.length) - 1];
  }

  const usageResponse = await request(
    `/users/${encodeURIComponent(externalId)}/usage`,
    { apiKey: account.apiKey },
  );

  const usageData = await readJson(usageResponse);
  const consumedUnits = Number(usageData.consumedUnits);

  console.log("\n--- Load Test Results ---");
  console.log(`Total requests:       ${TOTAL_REQUESTS}`);
  console.log(`Concurrency:          ${CONCURRENCY}`);
  console.log(`Accepted:             ${accepted}`);
  console.log(`Rejected:             ${rejected}`);
  console.log(`Errors:               ${errors}`);
  console.log(`Duration:             ${(durationMs / 1000).toFixed(2)} s`);
  console.log(`Throughput:           ${(TOTAL_REQUESTS / (durationMs / 1000)).toFixed(2)} requests/s`);
  console.log(`Average latency:      ${(latencies.reduce((sum, value) => sum + value, 0) / (latencies.length || 1)).toFixed(2)} ms`);
  console.log(`p50 latency:          ${percentile(0.50)?.toFixed(2) ?? "N/A"} ms`);
  console.log(`p95 latency:          ${percentile(0.95)?.toFixed(2) ?? "N/A"} ms`);
  console.log(`p99 latency:          ${percentile(0.99)?.toFixed(2) ?? "N/A"} ms`);
  console.log(`Expected consumed:    ${accepted * UNITS_PER_REQUEST}`);
  console.log(`Actual consumed:      ${consumedUnits}`);

  if (
    accepted !== TOTAL_REQUESTS ||
    rejected !== 0 ||
    errors !== 0 ||
    consumedUnits !== accepted * UNITS_PER_REQUEST
  ) {
    throw new Error("Load test failed: unexpected request results or usage total.");
  }

  console.log("\nPASS: all requests were accepted and usage totals match.");
}

main().catch((error) => {
  console.error("\nLOAD TEST FAILED:", error);
  process.exitCode = 1;
});
