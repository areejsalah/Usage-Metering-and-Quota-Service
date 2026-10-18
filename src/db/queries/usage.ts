import { and, eq, sql } from "drizzle-orm";
import { db } from "../index.js";
import {
  accountMonthlyUsage,
  userMonthlyUsage,
} from "../schema.js";

type DbExecutor = Pick<
  typeof db,
  "select" | "insert"
>;

export async function getAccountMonthlyUsage(
  database: DbExecutor,
  accountId: string,
  billingMonth: string,
) {
  const [usage] = await database
    .select()
    .from(accountMonthlyUsage)
    .where(
      and(
        eq(accountMonthlyUsage.accountId, accountId),
        eq(accountMonthlyUsage.billingMonth, billingMonth),
      ),
    )
    .limit(1);

  return usage;
}

export async function getUserMonthlyUsage(
  database: DbExecutor,
  userId: string,
  billingMonth: string,
) {
  const [usage] = await database
    .select()
    .from(userMonthlyUsage)
    .where(
      and(
        eq(userMonthlyUsage.userId, userId),
        eq(userMonthlyUsage.billingMonth, billingMonth),
      ),
    )
    .limit(1);

  return usage;
}

export async function incrementAccountMonthlyUsage(
  database: DbExecutor,
  accountId: string,
  billingMonth: string,
  units: number,
  now: Date,
) {
  await database
    .insert(accountMonthlyUsage)
    .values({
      accountId,
      billingMonth,
      consumedUnits: units,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        accountMonthlyUsage.accountId,
        accountMonthlyUsage.billingMonth,
      ],
      set: {
        consumedUnits: sql`${accountMonthlyUsage.consumedUnits} + ${units}`,
        updatedAt: now,
      },
    });
}

export async function incrementUserMonthlyUsage(
  database: DbExecutor,
  userId: string,
  billingMonth: string,
  units: number,
  now: Date,
) {
  await database
    .insert(userMonthlyUsage)
    .values({
      userId,
      billingMonth,
      consumedUnits: units,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        userMonthlyUsage.userId,
        userMonthlyUsage.billingMonth,
      ],
      set: {
        consumedUnits: sql`${userMonthlyUsage.consumedUnits} + ${units}`,
        updatedAt: now,
      },
    });
}
