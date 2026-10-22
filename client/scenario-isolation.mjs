import { createAccount, createDemoContext, demoExternalId } from "./edge-case-utils.mjs";

let demo;
try {
  demo = await createDemoContext("Account isolation demo");
  const foreignAccount = await createAccount("Foreign isolation demo account");
  const foreignUserId = demoExternalId("foreign-user");
  await demo.createUser(foreignUserId, null, foreignAccount.apiKey);

  console.log("CASE — Try to access a user that belongs to another account");
  const usage = await demo.call(`/users/${encodeURIComponent(foreignUserId)}/usage`, { allowedStatuses: [404] });
  console.log(`Read foreign user's usage: HTTP ${usage.status} ${JSON.stringify(usage.data)}`);
  const consume = await demo.consume(foreignUserId, 1, `foreign-${crypto.randomUUID()}`);
  console.log(`Consume for foreign user: HTTP ${consume.status} ${JSON.stringify(consume.data)}`);
  if (usage.status !== 404 || consume.status !== 404) {
    throw new Error("Expected the primary account to be unable to access the foreign account's user.");
  }
  console.log("Verified: user records are isolated by account.");
} catch (error) {
  console.error(`Isolation scenario failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await demo?.restore();
}
