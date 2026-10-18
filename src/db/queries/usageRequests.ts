import { and, eq } from "drizzle-orm";
import { db } from "../index.js";
import { usageRequests } from "../schema.js";


export async function getUsageRequestByRequestId(
  database: Pick<typeof db, "select">,
  accountId: string,
  requestId: string,
) {
  const [request] = await database
    .select()
    .from(usageRequests)
    .where(
      and(
        eq(usageRequests.accountId, accountId),
        eq(usageRequests.requestId, requestId),
      ),
    )
    .limit(1);

  return request;
}


export async function createUsageRequest(
  database: Pick<typeof db, "insert">,
  accountId: string,
  userId: string,
  requestId: string,
  units: number,
  status: string,
  rejectionReason: string | null,
  rejectionScope: string | null,
) {
  const [request] = await database
    .insert(usageRequests)
    .values({
      accountId,
      userId,
      requestId,
      units,
      status,
      rejectionReason,
      rejectionScope,
    })
    .returning();

  return request;
}
