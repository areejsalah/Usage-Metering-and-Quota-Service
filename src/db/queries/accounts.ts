import { eq } from "drizzle-orm";
import { db } from "../index.js";
import { accounts } from "../schema.js";

export async function createAccount(name: string, apiKeyHash: string) {
  const [account] = await db
    .insert(accounts)
    .values({
      name,
      apiKeyHash,
    })
    .returning({
      id: accounts.id,
      name: accounts.name,
      createdAt: accounts.createdAt,
    });

  return account;
}

export async function getAccountById(accountId: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  return account;
}
