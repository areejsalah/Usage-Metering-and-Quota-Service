
import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "../index.js";
import {
  accountPlanAssignments,
  userPlanAssignments,
} from "../schema.js";

export async function createAccountPlanAssignment(
  accountId: string,
  planId: string,
) {
  const [assignment] = await db
    .insert(accountPlanAssignments)
    .values({
      accountId,
      planId,
      effectiveFrom: new Date(),
    })
    .returning();

  return assignment;
}

export async function createUserPlanAssignment(
  userId: string,
  planId: string,
) {
  const [assignment] = await db
    .insert(userPlanAssignments)
    .values({
      userId,
      planId,
      effectiveFrom: new Date(),
    })
    .returning();

  return assignment;
}

export async function getCurrentAccountPlanAssignment(
  database: Pick<typeof db, "select">,
  accountId: string,
  now: Date,
) {
  const [assignment] = await database
    .select()
    .from(accountPlanAssignments)
    .where(
      and(
        eq(accountPlanAssignments.accountId, accountId),
        lte(accountPlanAssignments.effectiveFrom, now),
      ),
    )
    .orderBy(desc(accountPlanAssignments.effectiveFrom))
    .limit(1);

  return assignment;
}

export async function getCurrentUserPlanAssignment(
  database: Pick<typeof db, "select">,
  userId: string,
  now: Date,
) {
  const [assignment] = await database
    .select()
    .from(userPlanAssignments)
    .where(
      and(
        eq(userPlanAssignments.userId, userId),
        lte(userPlanAssignments.effectiveFrom, now),
      ),
    )
    .orderBy(desc(userPlanAssignments.effectiveFrom))
    .limit(1);

  return assignment;
}
