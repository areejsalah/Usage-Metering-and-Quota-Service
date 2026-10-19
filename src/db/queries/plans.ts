import { and, eq, or } from "drizzle-orm";
import { db } from "../index.js";
import { plans } from "../schema.js";

export async function createPlan(
  name: string,
  type: string,
  monthlyAllowance: number,
  maxUnitsPerRequest: number,
  accountId: string,
) {
  const [plan] = await db
    .insert(plans)
    .values({
      name,
      type,
      monthlyAllowance,
      maxUnitsPerRequest,
      isPredefined: false,
      accountId,
    })
    .returning();

  return plan;
}

export async function updatePlan(
  planId: string,
  accountId: string,
  name: string,
  monthlyAllowance: number,
  maxUnitsPerRequest: number,
) {
  const [plan] = await db
    .update(plans)
    .set({
      name,
      monthlyAllowance,
      maxUnitsPerRequest,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(plans.id, planId),
        eq(plans.accountId, accountId),
        eq(plans.isPredefined, false),
      ),
    )
    .returning();

  return plan;
}

export async function getAvailablePlans(accountId: string) {
  return db
    .select()
    .from(plans)
    .where(
      or(
        eq(plans.isPredefined, true),
        eq(plans.accountId, accountId),
      ),
    )
    .orderBy(plans.type, plans.name);
}

export async function getPlanById(
  database: Pick<typeof db, "select">,
  planId: string,
) {
  const [plan] = await database
    .select()
    .from(plans)
    .where(eq(plans.id, planId))
    .limit(1);

  return plan;
}