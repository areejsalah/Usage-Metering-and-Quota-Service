import { and, eq } from "drizzle-orm";
import { db } from "../index.js";
import { users } from "../schema.js";

export async function createUser(
  accountId: string,
  externalId: string,
) {
  const [user] = await db
    .insert(users)
    .values({
      accountId,
      externalId,
    })
    .returning({
      id: users.id,
      accountId: users.accountId,
      externalId: users.externalId,
      createdAt: users.createdAt,
    });

  return user;
}


export async function getUserByExternalId(
  database: Pick<typeof db, "select">,
  accountId: string,
  externalId: string,
) {
  const [user] = await database
    .select()
    .from(users)
    .where(
      and(
        eq(users.accountId, accountId),
        eq(users.externalId, externalId),
      ),
    )
    .limit(1);

  return user;
}

