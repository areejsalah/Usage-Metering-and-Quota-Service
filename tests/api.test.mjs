import assert from "node:assert/strict";
import { before, test } from "node:test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

let account1;
let account2;
let customPlan;
let testUser;
let userPlan;

async function request(path, { apiKey, method = "GET", body } = {}) {
  const headers = {};

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  return fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createAccount(name) {
  const response = await request("/accounts", {
    method: "POST",
    body: { name },
  });

  assert.equal(response.status, 201, "Account creation should succeed");
  return response.json();
}

before(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  account1 = await createAccount(`Automated Test A ${suffix}`);
  account2 = await createAccount(`Automated Test B ${suffix}`);

  const response = await request("/plans", {
    apiKey: account1.apiKey,
    method: "POST",
    body: {
      name: `Isolation Test Plan ${suffix}`,
      type: "account",
      monthlyAllowance: 10000,
      maxUnitsPerRequest: 1000,
    },
  });

  assert.equal(response.status, 201, "Custom plan creation should succeed");

  const data = await response.json();
  
  // Get the predefined plans available to Account 1.
  const plansResponse = await request("/plans", {
    apiKey: account1.apiKey,
  });

  assert.equal(plansResponse.status, 200);

  const { plans } = await plansResponse.json();

  const accountPlan = plans.find(
    (plan) => plan.name === "Pro" && plan.type === "account",
  );

  userPlan = plans.find(
    (plan) => plan.name === "Basic" && plan.type === "user",
  );

  assert.ok(accountPlan, "Pro account plan must exist");
  assert.ok(userPlan, "Basic user plan must exist");

  // Assign the account plan.
  const accountAssignmentResponse = await request("/account/plan", {
    apiKey: account1.apiKey,
    method: "POST",
    body: { planId: accountPlan.id },
  });

  assert.equal(accountAssignmentResponse.status, 201);

  // Create an isolated test user.
  const userResponse = await request("/users", {
    apiKey: account1.apiKey,
    method: "POST",
    body: { externalId: `usage-test-${Date.now()}` },
  });

  assert.equal(userResponse.status, 201);

  const userData = await userResponse.json();
  testUser = userData.user;

  // Assign the user plan.
  const userAssignmentResponse = await request(
    `/users/${encodeURIComponent(testUser.externalId)}/plan`,
    {
      apiKey: account1.apiKey,
      method: "POST",
      body: { planId: userPlan.id },
    },
  );

  assert.equal(userAssignmentResponse.status, 201);

  customPlan = data.plan;

  assert.ok(customPlan?.id, "The created plan should have an ID");
});

test("rejects requests without an API key", async () => {
  const response = await request("/plans");

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "API key is required",
  });
});

test("rejects an invalid API key", async () => {
  const response = await request("/plans", {
    apiKey: "invalid-test-api-key",
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Invalid API key",
  });
});

test("allows a valid API key to access plans", async () => {
  const response = await request("/plans", {
    apiKey: account1.apiKey,
  });

  assert.equal(response.status, 200);

  const data = await response.json();
  assert.ok(Array.isArray(data.plans));
});

test("does not expose another account's custom plan", async () => {
  const response = await request("/plans", {
    apiKey: account2.apiKey,
  });

  assert.equal(response.status, 200);

  const data = await response.json();
  assert.ok(
    !data.plans.some((plan) => plan.id === customPlan.id),
    "Account 2 must not see Account 1's custom plan",
  );
});

test("prevents another account from updating a custom plan", async () => {
  const response = await request(`/plans/${customPlan.id}`, {
    apiKey: account2.apiKey,
    method: "PATCH",
    body: { monthlyAllowance: 20000 },
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Custom plan not found in this account",
  });
});


test("accepts valid usage and does not count an idempotent retry twice", async () => {
  const requestId = `usage-idempotency-${Date.now()}`;

  const body = {
    externalId: testUser.externalId,
    units: 10,
    requestId,
  };

  const firstResponse = await request("/usage/consume", {
    apiKey: account1.apiKey,
    method: "POST",
    body,
  });

  assert.equal(firstResponse.status, 200);

  const firstResult = await firstResponse.json();

  assert.equal(firstResult.status, "ACCEPTED");
  assert.equal(firstResult.units, 10);
  assert.equal(firstResult.idempotent, false);

  const retryResponse = await request("/usage/consume", {
    apiKey: account1.apiKey,
    method: "POST",
    body,
  });

  assert.equal(retryResponse.status, 200);

  const retryResult = await retryResponse.json();

  assert.equal(retryResult.status, "ACCEPTED");
  assert.equal(retryResult.idempotent, true);

  const usageResponse = await request(
    `/users/${encodeURIComponent(testUser.externalId)}/usage`,
    { apiKey: account1.apiKey },
  );

  assert.equal(usageResponse.status, 200);

  const usage = await usageResponse.json();

  assert.equal(
    usage.consumedUnits,
    10,
    "Retrying the same request must not increase usage twice",
  );
});


test("rejects reusing a request ID with different usage data", async () => {
  const requestId = `usage-conflict-${Date.now()}`;

  const firstResponse = await request("/usage/consume", {
    apiKey: account1.apiKey,
    method: "POST",
    body: {
      externalId: testUser.externalId,
      units: 5,
      requestId,
    },
  });

  assert.equal(firstResponse.status, 200);

  const usageAfterFirstResponse = await request(
    `/users/${encodeURIComponent(testUser.externalId)}/usage`,
    { apiKey: account1.apiKey },
  );
  assert.equal(usageAfterFirstResponse.status, 200);
  const usageAfterFirst = await usageAfterFirstResponse.json();

  const conflictResponse = await request("/usage/consume", {
    apiKey: account1.apiKey,
    method: "POST",
    body: {
      externalId: testUser.externalId,
      units: 6,
      requestId,
    },
  });

  assert.equal(conflictResponse.status, 409);

  const usageAfterConflictResponse = await request(
    `/users/${encodeURIComponent(testUser.externalId)}/usage`,
    { apiKey: account1.apiKey },
  );
  assert.equal(usageAfterConflictResponse.status, 200);
  const usageAfterConflict = await usageAfterConflictResponse.json();

  assert.equal(
    usageAfterConflict.consumedUnits,
    usageAfterFirst.consumedUnits,
    "Conflicting retry must not change usage",
  );
});

test("rejects reusing a request ID with a different user", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const secondExternalId = `idempotency-user-${suffix}`;
  const requestId = `usage-user-conflict-${suffix}`;
  const units = 5;

  const createUserResponse = await request("/users", {
    apiKey: account1.apiKey,
    method: "POST",
    body: { externalId: secondExternalId },
  });

  assert.equal(createUserResponse.status, 201);

  const assignPlanResponse = await request(
    `/users/${encodeURIComponent(secondExternalId)}/plan`,
    {
      apiKey: account1.apiKey,
      method: "POST",
      body: { planId: userPlan.id },
    },
  );

  assert.equal(assignPlanResponse.status, 201);

  const firstResponse = await request("/usage/consume", {
    apiKey: account1.apiKey,
    method: "POST",
    body: {
      externalId: testUser.externalId,
      units,
      requestId,
    },
  });

  assert.equal(firstResponse.status, 200);

  const firstUserUsageBeforeResponse = await request(
    `/users/${encodeURIComponent(testUser.externalId)}/usage`,
    { apiKey: account1.apiKey },
  );
  assert.equal(firstUserUsageBeforeResponse.status, 200);
  const firstUserUsageBefore = await firstUserUsageBeforeResponse.json();

  const secondUserUsageBeforeResponse = await request(
    `/users/${encodeURIComponent(secondExternalId)}/usage`,
    { apiKey: account1.apiKey },
  );
  assert.equal(secondUserUsageBeforeResponse.status, 200);
  const secondUserUsageBefore = await secondUserUsageBeforeResponse.json();

  const conflictResponse = await request("/usage/consume", {
    apiKey: account1.apiKey,
    method: "POST",
    body: {
      externalId: secondExternalId,
      units,
      requestId,
    },
  });

  assert.equal(conflictResponse.status, 409);

  const firstUserUsageAfterResponse = await request(
    `/users/${encodeURIComponent(testUser.externalId)}/usage`,
    { apiKey: account1.apiKey },
  );
  assert.equal(firstUserUsageAfterResponse.status, 200);
  const firstUserUsageAfter = await firstUserUsageAfterResponse.json();

  const secondUserUsageAfterResponse = await request(
    `/users/${encodeURIComponent(secondExternalId)}/usage`,
    { apiKey: account1.apiKey },
  );
  assert.equal(secondUserUsageAfterResponse.status, 200);
  const secondUserUsageAfter = await secondUserUsageAfterResponse.json();

  assert.equal(
    firstUserUsageAfter.consumedUnits,
    firstUserUsageBefore.consumedUnits,
    "Conflicting retry must not change the first user's usage",
  );
  assert.equal(
    secondUserUsageAfter.consumedUnits,
    secondUserUsageBefore.consumedUnits,
    "Conflicting retry must not change the second user's usage",
  );
});

test("rejects zero and negative usage units", async (t) => {
  for (const units of [0, -1]) {
    await t.test(`units = ${units}`, async () => {
      const response = await request("/usage/consume", {
        apiKey: account1.apiKey,
        method: "POST",
        body: {
          externalId: testUser.externalId,
          units,
          requestId: `invalid-units-${units}-${Date.now()}`,
        },
      });

      assert.equal(response.status, 400);

      assert.deepEqual(await response.json(), {
        error: "units must be a positive safe integer",
      });
    });
  }
});


test("rejects usage beyond the user monthly allowance without increasing usage", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const planResponse = await request("/plans", {
    apiKey: account1.apiKey,
    method: "POST",
    body: {
      name: `Small User Allowance ${suffix}`,
      type: "user",
      monthlyAllowance: 20,
      maxUnitsPerRequest: 20,
    },
  });

  assert.equal(planResponse.status, 201);
  const { plan } = await planResponse.json();

  const externalId = `allowance-test-${suffix}`;

  const createUserResponse = await request("/users", {
    apiKey: account1.apiKey,
    method: "POST",
    body: { externalId },
  });

  assert.equal(createUserResponse.status, 201);

  const assignPlanResponse = await request(
    `/users/${encodeURIComponent(externalId)}/plan`,
    {
      apiKey: account1.apiKey,
      method: "POST",
      body: { planId: plan.id },
    },
  );

  assert.equal(assignPlanResponse.status, 201);

  const firstResponse = await request("/usage/consume", {
    apiKey: account1.apiKey,
    method: "POST",
    body: {
      externalId,
      units: 20,
      requestId: `allowance-full-${suffix}`,
    },
  });

  assert.equal(firstResponse.status, 200);

  const rejectedResponse = await request("/usage/consume", {
    apiKey: account1.apiKey,
    method: "POST",
    body: {
      externalId,
      units: 1,
      requestId: `allowance-over-${suffix}`,
    },
  });

  assert.equal(rejectedResponse.status, 429);

  const rejected = await rejectedResponse.json();

  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.rejectionScope, "user");
  assert.equal(rejected.rejectionReason, "User monthly allowance exceeded");

  const usageResponse = await request(
    `/users/${encodeURIComponent(externalId)}/usage`,
    { apiKey: account1.apiKey },
  );

  assert.equal(usageResponse.status, 200);

  const usage = await usageResponse.json();

  assert.equal(
    usage.consumedUnits,
    20,
    "Rejected usage must not increase the user's consumed units",
  );
});



test("rejects usage beyond the account monthly allowance without increasing usage", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Use a fresh account so previous tests cannot affect its usage.
  const testAccount = await createAccount(`Account Limit Test ${suffix}`);
  const apiKey = testAccount.apiKey;

  const accountPlanResponse = await request("/plans", {
    apiKey,
    method: "POST",
    body: {
      name: `Small Account Allowance ${suffix}`,
      type: "account",
      monthlyAllowance: 20,
      maxUnitsPerRequest: 20,
    },
  });

  assert.equal(accountPlanResponse.status, 201);
  const { plan: accountPlan } = await accountPlanResponse.json();

  const accountAssignmentResponse = await request("/account/plan", {
    apiKey,
    method: "POST",
    body: { planId: accountPlan.id },
  });

  assert.equal(accountAssignmentResponse.status, 201);

  const externalId = `account-limit-test-${suffix}`;

  const userResponse = await request("/users", {
    apiKey,
    method: "POST",
    body: { externalId },
  });

  assert.equal(userResponse.status, 201);

  const userPlanResponse = await request("/plans", {
    apiKey,
    method: "POST",
    body: {
      name: `Large User Allowance ${suffix}`,
      type: "user",
      monthlyAllowance: 1000,
      maxUnitsPerRequest: 20,
    },
  });

  assert.equal(userPlanResponse.status, 201);
  const { plan: userPlan } = await userPlanResponse.json();

  const userAssignmentResponse = await request(
    `/users/${encodeURIComponent(externalId)}/plan`,
    {
      apiKey,
      method: "POST",
      body: { planId: userPlan.id },
    },
  );

  assert.equal(userAssignmentResponse.status, 201);

  const firstResponse = await request("/usage/consume", {
    apiKey,
    method: "POST",
    body: {
      externalId,
      units: 20,
      requestId: `account-full-${suffix}`,
    },
  });

  assert.equal(firstResponse.status, 200);

  const rejectedResponse = await request("/usage/consume", {
    apiKey,
    method: "POST",
    body: {
      externalId,
      units: 1,
      requestId: `account-over-${suffix}`,
    },
  });

  assert.equal(rejectedResponse.status, 429);

  const rejected = await rejectedResponse.json();

  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.rejectionScope, "account");
  assert.equal(rejected.rejectionReason, "Account monthly allowance exceeded");

  const userUsageResponse = await request(
    `/users/${encodeURIComponent(externalId)}/usage`,
    { apiKey },
  );

  assert.equal(userUsageResponse.status, 200);
  assert.equal((await userUsageResponse.json()).consumedUnits, 20);

  const accountUsageResponse = await request("/account/usage", {
    apiKey,
  });

  assert.equal(accountUsageResponse.status, 200);
  assert.equal(
    (await accountUsageResponse.json()).consumedUnits,
    20,
    "Rejected usage must not increase account consumption",
  );
});


test("rejects usage exceeding the user's max units per request", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const testAccount = await createAccount(`Max Units Test ${suffix}`);
  const apiKey = testAccount.apiKey;

  const accountPlanResponse = await request("/plans", {
    apiKey,
    method: "POST",
    body: {
      name: `Account Plan ${suffix}`,
      type: "account",
      monthlyAllowance: 1000,
      maxUnitsPerRequest: 1000,
    },
  });

  assert.equal(accountPlanResponse.status, 201);
  const { plan: accountPlan } = await accountPlanResponse.json();

  const accountAssignmentResponse = await request("/account/plan", {
    apiKey,
    method: "POST",
    body: { planId: accountPlan.id },
  });

  assert.equal(accountAssignmentResponse.status, 201);

  const externalId = `max-units-user-${suffix}`;

  const userResponse = await request("/users", {
    apiKey,
    method: "POST",
    body: { externalId },
  });

  assert.equal(userResponse.status, 201);

  const userPlanResponse = await request("/plans", {
    apiKey,
    method: "POST",
    body: {
      name: `User Plan ${suffix}`,
      type: "user",
      monthlyAllowance: 1000,
      maxUnitsPerRequest: 5,
    },
  });

  assert.equal(userPlanResponse.status, 201);
  const { plan: userPlan } = await userPlanResponse.json();

  const userAssignmentResponse = await request(
    `/users/${encodeURIComponent(externalId)}/plan`,
    {
      apiKey,
      method: "POST",
      body: { planId: userPlan.id },
    },
  );

  assert.equal(userAssignmentResponse.status, 201);

  const consumeResponse = await request("/usage/consume", {
    apiKey,
    method: "POST",
    body: {
      externalId,
      units: 6,
      requestId: `max-units-request-${suffix}`,
    },
  });

  assert.equal(consumeResponse.status, 429);

  const result = await consumeResponse.json();

  assert.equal(result.status, "REJECTED");
  assert.equal(result.rejectionScope, "user");
  assert.equal(
    result.rejectionReason,
    "User max units per request exceeded",
  );

  const usageResponse = await request(
    `/users/${encodeURIComponent(externalId)}/usage`,
    { apiKey },
  );

  assert.equal(usageResponse.status, 200);
  assert.equal(
    (await usageResponse.json()).consumedUnits,
    0,
    "Rejected usage must not increase consumption",
  );
});

test("rejects usage exceeding the account max units per request", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const testAccount = await createAccount(`Account Max Units Test ${suffix}`);
  const apiKey = testAccount.apiKey;

  const accountPlanResponse = await request("/plans", {
    apiKey,
    method: "POST",
    body: {
      name: `Small Max Units Account Plan ${suffix}`,
      type: "account",
      monthlyAllowance: 1000,
      maxUnitsPerRequest: 5,
    },
  });

  assert.equal(accountPlanResponse.status, 201);
  const { plan: accountPlan } = await accountPlanResponse.json();

  const accountAssignmentResponse = await request("/account/plan", {
    apiKey,
    method: "POST",
    body: { planId: accountPlan.id },
  });

  assert.equal(accountAssignmentResponse.status, 201);

  const externalId = `account-max-units-user-${suffix}`;

  const userResponse = await request("/users", {
    apiKey,
    method: "POST",
    body: { externalId },
  });

  assert.equal(userResponse.status, 201);

  const userPlanResponse = await request("/plans", {
    apiKey,
    method: "POST",
    body: {
      name: `Large Max Units User Plan ${suffix}`,
      type: "user",
      monthlyAllowance: 1000,
      maxUnitsPerRequest: 100,
    },
  });

  assert.equal(userPlanResponse.status, 201);
  const { plan: userPlan } = await userPlanResponse.json();

  const userAssignmentResponse = await request(
    `/users/${encodeURIComponent(externalId)}/plan`,
    {
      apiKey,
      method: "POST",
      body: { planId: userPlan.id },
    },
  );

  assert.equal(userAssignmentResponse.status, 201);

  const consumeResponse = await request("/usage/consume", {
    apiKey,
    method: "POST",
    body: {
      externalId,
      units: 6,
      requestId: `account-max-units-request-${suffix}`,
    },
  });

  assert.equal(consumeResponse.status, 429);

  const result = await consumeResponse.json();

  assert.equal(result.status, "REJECTED");
  assert.equal(result.rejectionScope, "account");
  assert.equal(
    result.rejectionReason,
    "Account max units per request exceeded",
  );

  const usageResponse = await request("/account/usage", { apiKey });

  assert.equal(usageResponse.status, 200);
  assert.equal(
    (await usageResponse.json()).consumedUnits,
    0,
    "Rejected usage must not increase account consumption",
  );
});

test("returns usage history with pagination and account isolation", async () => {
  const requestId1 = `history-test-1-${Date.now()}`;
  const requestId2 = `history-test-2-${Date.now()}`;

  for (const requestId of [requestId1, requestId2]) {
    const consumeResponse = await request("/usage/consume", {
      apiKey: account1.apiKey,
      method: "POST",
      body: {
        externalId: testUser.externalId,
        units: 1,
        requestId,
      },
    });

    assert.equal(
      consumeResponse.status,
      200,
      `Usage request ${requestId} should be accepted`,
    );
  }

  const firstPageResponse = await request(
    "/usage/history?limit=1&offset=0",
    { apiKey: account1.apiKey },
  );

  assert.equal(firstPageResponse.status, 200);

  const firstPage = await firstPageResponse.json();

  assert.equal(firstPage.limit, 1);
  assert.equal(firstPage.offset, 0);
  assert.equal(firstPage.requests.length, 1);

  const secondPageResponse = await request(
    "/usage/history?limit=1&offset=1",
    { apiKey: account1.apiKey },
  );

  assert.equal(secondPageResponse.status, 200);

  const secondPage = await secondPageResponse.json();

  assert.equal(secondPage.limit, 1);
  assert.equal(secondPage.offset, 1);
  assert.equal(secondPage.requests.length, 1);

  const firstPageIds = firstPage.requests.map(
    (item) => item.requestId,
  );
  const secondPageIds = secondPage.requests.map(
    (item) => item.requestId,
  );

  assert.notDeepEqual(
    firstPageIds,
    secondPageIds,
    "Different pages should return different requests",
  );
  const fullHistoryResponse = await request(
  "/usage/history?limit=100&offset=0",
  { apiKey: account1.apiKey },
);

assert.equal(fullHistoryResponse.status, 200);

const fullHistory = await fullHistoryResponse.json();

const firstCreatedAt = new Date(
  fullHistory.requests[0].createdAt,
).getTime();

const secondCreatedAt = new Date(
  fullHistory.requests[1].createdAt,
).getTime();

assert.ok(
  firstCreatedAt >= secondCreatedAt,
  "Usage history should be ordered from newest to oldest",
);

  const account2HistoryResponse = await request(
    "/usage/history?limit=100",
    { apiKey: account2.apiKey },
  );

  assert.equal(account2HistoryResponse.status, 200);

  const account2History = await account2HistoryResponse.json();

  const account2RequestIds = account2History.requests.map(
    (item) => item.requestId,
  );

  assert.ok(!account2RequestIds.includes(requestId1));
  assert.ok(!account2RequestIds.includes(requestId2));
});


test("enforces a user's monthly allowance for concurrent usage requests", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const externalId = `concurrent-limit-user-${suffix}`;
  const requestPrefix = `concurrent-user-limit-${suffix}`;

  const planResponse = await request("/plans", {
    apiKey: account1.apiKey,
    method: "POST",
    body: {
      name: `Concurrent User Allowance ${suffix}`,
      type: "user",
      monthlyAllowance: 20,
      maxUnitsPerRequest: 10,
    },
  });

  assert.equal(planResponse.status, 201);
  const { plan } = await planResponse.json();

  const createUserResponse = await request("/users", {
    apiKey: account1.apiKey,
    method: "POST",
    body: { externalId },
  });

  assert.equal(createUserResponse.status, 201);

  const assignPlanResponse = await request(
    `/users/${encodeURIComponent(externalId)}/plan`,
    {
      apiKey: account1.apiKey,
      method: "POST",
      body: { planId: plan.id },
    },
  );

  assert.equal(assignPlanResponse.status, 201);

  const responses = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      request("/usage/consume", {
        apiKey: account1.apiKey,
        method: "POST",
        body: {
          externalId,
          units: 10,
          requestId: `${requestPrefix}-${index}`,
        },
      }),
    ),
  );

  const results = await Promise.all(
    responses.map(async (response) => ({
      status: response.status,
      body: await response.json(),
    })),
  );

  const acceptedResults = results.filter(
    (result) => result.status === 200 && result.body.status === "ACCEPTED",
  );
  const rejectedResults = results.filter(
    (result) => result.status === 429 && result.body.status === "REJECTED",
  );

  assert.equal(acceptedResults.length, 2);
  assert.equal(rejectedResults.length, 3);
  assert.ok(
    rejectedResults.every(
      (result) =>
        result.body.rejectionScope === "user" &&
        result.body.rejectionReason === "User monthly allowance exceeded",
    ),
  );

  const usageResponse = await request(
    `/users/${encodeURIComponent(externalId)}/usage`,
    { apiKey: account1.apiKey },
  );

  assert.equal(usageResponse.status, 200);
  const usage = await usageResponse.json();
  assert.equal(usage.consumedUnits, 20);
});

test("uses updated custom user plan settings for subsequent usage requests", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const externalId = `updated-plan-user-${suffix}`;

  const planResponse = await request("/plans", {
    apiKey: account1.apiKey,
    method: "POST",
    body: {
      name: `Updated User Plan ${suffix}`,
      type: "user",
      monthlyAllowance: 20,
      maxUnitsPerRequest: 30,
    },
  });

  assert.equal(planResponse.status, 201);
  const { plan } = await planResponse.json();

  const createUserResponse = await request("/users", {
    apiKey: account1.apiKey,
    method: "POST",
    body: { externalId },
  });

  assert.equal(createUserResponse.status, 201);

  const assignPlanResponse = await request(
    `/users/${encodeURIComponent(externalId)}/plan`,
    {
      apiKey: account1.apiKey,
      method: "POST",
      body: { planId: plan.id },
    },
  );

  assert.equal(assignPlanResponse.status, 201);

  const updateResponse = await request(`/plans/${plan.id}`, {
    apiKey: account1.apiKey,
    method: "PATCH",
    body: { monthlyAllowance: 30 },
  });

  assert.equal(updateResponse.status, 200);
  const { plan: updatedPlan } = await updateResponse.json();
  assert.equal(updatedPlan.monthlyAllowance, 30);
  assert.equal(updatedPlan.maxUnitsPerRequest, 30);

  const consumeResponse = await request("/usage/consume", {
    apiKey: account1.apiKey,
    method: "POST",
    body: {
      externalId,
      units: 25,
      requestId: `updated-plan-usage-${suffix}`,
    },
  });

  assert.equal(consumeResponse.status, 200);
  const consumeResult = await consumeResponse.json();
  assert.equal(consumeResult.status, "ACCEPTED");

  const usageResponse = await request(
    `/users/${encodeURIComponent(externalId)}/usage`,
    { apiKey: account1.apiKey },
  );

  assert.equal(usageResponse.status, 200);
  const usage = await usageResponse.json();
  assert.equal(usage.consumedUnits, 25);
});

test("handles concurrent usage requests without losing or double-counting usage", async () => {
  const requestCount = 10;
  const unitsPerRequest = 10;
  const prefix = `concurrent-${Date.now()}`;

  const usageBeforeResponse = await request(
  `/users/${encodeURIComponent(testUser.externalId)}/usage`,
  { apiKey: account1.apiKey },
);

assert.equal(usageBeforeResponse.status, 200);

const usageBefore = await usageBeforeResponse.json();

  const responses = await Promise.all(
    Array.from({ length: requestCount }, (_, index) =>
      request("/usage/consume", {
        apiKey: account1.apiKey,
        method: "POST",
        body: {
          externalId: testUser.externalId,
          units: unitsPerRequest,
          requestId: `${prefix}-${index}`,
        },
      }),
    ),
  );

  const results = await Promise.all(
    responses.map(async (response) => ({
      status: response.status,
      body: await response.json(),
    })),
  );

  assert.ok(
    results.every(
      (result) =>
        result.status === 200 &&
        result.body.status === "ACCEPTED",
    ),
    "All concurrent requests should be accepted",
  );

  const usageResponse = await request(
    `/users/${encodeURIComponent(testUser.externalId)}/usage`,
    { apiKey: account1.apiKey },
  );

  assert.equal(usageResponse.status, 200);

  const usage = await usageResponse.json();

  assert.equal(
  usage.consumedUnits - usageBefore.consumedUnits,
  requestCount * unitsPerRequest,
  "Concurrent requests should be counted exactly once",
);
});

