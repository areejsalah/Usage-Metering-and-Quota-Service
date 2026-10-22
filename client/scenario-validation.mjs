import { randomUUID } from "node:crypto";
import { createDemoContext, demoExternalId } from "./edge-case-utils.mjs";

let demo;
try {
  demo = await createDemoContext("Validation demo account");
  const externalId = demoExternalId("validation-user");
  await demo.createUser(externalId);

  console.log("CASE — Submit invalid usage requests and inspect validation errors");
  const zeroUnits = await demo.consume(externalId, 0, `zero-${randomUUID()}`);
  console.log(`Zero units: HTTP ${zeroUnits.status} ${JSON.stringify(zeroUnits.data)}`);
  const missingRequestId = await demo.call("/usage/consume", {
    method: "POST",
    body: { externalId, units: 1 },
    allowedStatuses: [400],
  });
  console.log(`Missing requestId: HTTP ${missingRequestId.status} ${JSON.stringify(missingRequestId.data)}`);
  const missingExternalId = await demo.call("/usage/consume", {
    method: "POST",
    body: { units: 1, requestId: `missing-user-${randomUUID()}` },
    allowedStatuses: [400],
  });
  console.log(`Missing externalId: HTTP ${missingExternalId.status} ${JSON.stringify(missingExternalId.data)}`);

  if (zeroUnits.status !== 400 || missingRequestId.status !== 400 || missingExternalId.status !== 400) {
    throw new Error("Expected all malformed requests to return HTTP 400.");
  }
  console.log("Verified: all invalid requests returned validation errors and did not consume usage.");
} catch (error) {
  console.error(`Validation scenario failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await demo?.restore();
}
