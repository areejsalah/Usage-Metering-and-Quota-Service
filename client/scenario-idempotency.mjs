import { createDemoContext, demoExternalId } from "./edge-case-utils.mjs";

let demo;
try {
  demo = await createDemoContext("Idempotency demo account");
  const externalId = demoExternalId("idempotency-user");
  await demo.createUser(externalId);
  const requestId = `idempotency-${crypto.randomUUID()}`;
  const before = (await demo.call(`/users/${encodeURIComponent(externalId)}/usage`)).data.consumedUnits;

  console.log("CASE — Retry an identical request ID and reject changed request data");
  const first = await demo.consume(externalId, 3, requestId);
  console.log(`First request: HTTP ${first.status} ${JSON.stringify(first.data)}`);
  const retry = await demo.consume(externalId, 3, requestId);
  console.log(`Identical retry: HTTP ${retry.status} ${JSON.stringify(retry.data)}`);
  if (first.status !== 200 || retry.status !== 200 || retry.data.idempotent !== true) {
    throw new Error("Expected the identical retry to return an idempotent success.");
  }

  const afterRetry = (await demo.call(`/users/${encodeURIComponent(externalId)}/usage`)).data.consumedUnits;
  if (afterRetry - before !== 3) throw new Error(`Expected usage to increase by 3 once; observed ${afterRetry - before}.`);
  const conflict = await demo.consume(externalId, 4, requestId);
  console.log(`Same request ID with different units: HTTP ${conflict.status} ${JSON.stringify(conflict.data)}`);
  const afterConflict = (await demo.call(`/users/${encodeURIComponent(externalId)}/usage`)).data.consumedUnits;
  if (conflict.status !== 409 || afterConflict !== afterRetry) throw new Error("Expected a conflict without changing usage.");
  console.log(`Verified: one count only; usage remains ${afterConflict}.`);
} catch (error) {
  console.error(`Idempotency scenario failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await demo?.restore();
}
