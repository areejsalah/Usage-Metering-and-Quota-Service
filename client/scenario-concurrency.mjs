import { randomUUID } from "node:crypto";
import { createDemoContext, demoExternalId } from "./edge-case-utils.mjs";

let demo;
try {
  demo = await createDemoContext("Concurrency demo account");
  const externalId = demoExternalId("concurrent-user");
  await demo.createUser(externalId);
  const before = (await demo.call(`/users/${encodeURIComponent(externalId)}/usage`)).data.consumedUnits;
  const requestCount = 8;

  console.log(`CASE — Send ${requestCount} simultaneous 1-unit requests for one user`);
  const results = await Promise.all(Array.from({ length: requestCount }, async (_, index) => {
    const requestId = `parallel-${randomUUID()}`;
    const result = await demo.consume(externalId, 1, requestId);
    console.log(`Request ${index + 1}: HTTP ${result.status} ${JSON.stringify(result.data)}`);
    return result;
  }));

  const after = (await demo.call(`/users/${encodeURIComponent(externalId)}/usage`)).data.consumedUnits;
  if (results.some((result) => result.status !== 200) || after - before !== requestCount) {
    throw new Error(`Expected ${requestCount} accepted units; observed ${after - before}.`);
  }
  console.log(`Verified: all ${requestCount} requests accepted and counted once; usage increased by ${after - before}.`);
} catch (error) {
  console.error(`Concurrency scenario failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await demo?.restore();
}
