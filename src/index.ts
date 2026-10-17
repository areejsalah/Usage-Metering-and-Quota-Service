import { randomBytes, createHash } from "node:crypto";
import express from "express";
import { and, desc, eq, lte, or, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./db/index.js";
import {
  accounts,
  plans,
  users,
  accountPlanAssignments,
  userPlanAssignments,
  accountMonthlyUsage,
  userMonthlyUsage,
  usageRequests,
} from "./db/schema.js";
import { authenticateApiKey } from "./auth.js";

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Usage Metering Service is running",
  });
});

app.post("/accounts", async (req, res, next) => {
  try {
    const { name } = req.body;

    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({
        error: "name is required and must be a non-empty string",
      });
      return;
    }

    const apiKey = randomBytes(32).toString("hex");

    const apiKeyHash = createHash("sha256")
      .update(apiKey)
      .digest("hex");

    const [account] = await db
      .insert(accounts)
      .values({
        name: name.trim(),
        apiKeyHash,
      })
      .returning({
        id: accounts.id,
        name: accounts.name,
        createdAt: accounts.createdAt,
      });

    res.status(201).json({
      account,
      apiKey,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/users", authenticateApiKey, async (req, res, next) => {
  try {
    const account = res.locals.account as { id: string };
    const { externalId } = req.body;

    if (
      typeof externalId !== "string" ||
      externalId.trim().length === 0
    ) {
      res.status(400).json({
        error: "externalId is required and must be a non-empty string",
      });
      return;
    }

    const normalizedExternalId = externalId.trim();

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.accountId, account.id),
          eq(users.externalId, normalizedExternalId),
        ),
      )
      .limit(1);

    if (existingUser) {
      res.status(409).json({
        error: "User already exists for this account",
      });
      return;
    }

    const [user] = await db
      .insert(users)
      .values({
        accountId: account.id,
        externalId: normalizedExternalId,
      })
      .returning({
        id: users.id,
        accountId: users.accountId,
        externalId: users.externalId,
        createdAt: users.createdAt,
      });

    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

// Create a custom plan owned by the authenticated account.
app.post("/plans", authenticateApiKey, async (req, res, next) => {
  try {
    const account = res.locals.account as { id: string };
    const { name, type, monthlyAllowance, maxUnitsPerRequest } = req.body;

    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "A non-empty name is required" });
      return;
    }

    if (type !== "account" && type !== "user") {
      res.status(400).json({
        error: "type must be 'account' or 'user'",
      });
      return;
    }

    if (
      !Number.isSafeInteger(monthlyAllowance) ||
      monthlyAllowance <= 0
    ) {
      res.status(400).json({
        error: "monthlyAllowance must be a positive safe integer",
      });
      return;
    }

    if (
      !Number.isSafeInteger(maxUnitsPerRequest) ||
      maxUnitsPerRequest <= 0
    ) {
      res.status(400).json({
        error: "maxUnitsPerRequest must be a positive safe integer",
      });
      return;
    }

    const [plan] = await db
      .insert(plans)
      .values({
        name: name.trim(),
        type,
        monthlyAllowance,
        maxUnitsPerRequest,
        isPredefined: false,
        accountId: account.id,
      })
      .returning();

    res.status(201).json({ plan });
  } catch (error) {
    next(error);
  }
});

// List predefined plans and custom plans available to this account.
app.get("/plans", authenticateApiKey, async (req, res, next) => {
  try {
    const account = res.locals.account as { id: string };

    const availablePlans = await db
      .select()
      .from(plans)
      .where(
        or(
          eq(plans.isPredefined, true),
          eq(plans.accountId, account.id),
        ),
      )
      .orderBy(plans.type, plans.name);

    res.status(200).json({ plans: availablePlans });
  } catch (error) {
    next(error);
  }
});

// Assign an account-level plan.
app.post("/account/plan", authenticateApiKey, async (req, res, next) => {
  try {
    const account = res.locals.account as { id: string };
    const { planId } = req.body;

    if (typeof planId !== "string") {
      res.status(400).json({ error: "planId is required" });
      return;
    }

    const [plan] = await db
      .select()
      .from(plans)
      .where(eq(plans.id, planId))
      .limit(1);

    if (
      !plan ||
      plan.type !== "account" ||
      (!plan.isPredefined && plan.accountId !== account.id)
    ) {
      res.status(400).json({
        error: "Invalid account plan or plan is not accessible",
      });
      return;
    }

    const [assignment] = await db
      .insert(accountPlanAssignments)
      .values({
        accountId: account.id,
        planId: plan.id,
        effectiveFrom: new Date(),
      })
      .returning();

    res.status(201).json({ assignment, plan });
  } catch (error) {
    next(error);
  }
});

// Assign a user-level plan to a user belonging to this account.
app.post(
  "/users/:externalId/plan",
  authenticateApiKey,
  async (req, res, next) => {
    try {
      const account = res.locals.account as { id: string };
      const externalId = req.params.externalId;
      const { planId } = req.body;

      if (typeof externalId !== "string") {
         res.status(400).json({
         error: "Invalid externalId",
      });
      return;
      }
      if (typeof planId !== "string") {
        res.status(400).json({ error: "planId is required" });
        return;
      }

      const [user] = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.accountId, account.id),
            eq(users.externalId, externalId),
          ),
        )
        .limit(1);

      if (!user) {
        res.status(404).json({
          error: "User not found in this account",
        });
        return;
      }

      const [plan] = await db
        .select()
        .from(plans)
        .where(eq(plans.id, planId))
        .limit(1);

      if (
        !plan ||
        plan.type !== "user" ||
        (!plan.isPredefined && plan.accountId !== account.id)
      ) {
        res.status(400).json({
          error: "Invalid user plan or plan is not accessible",
        });
        return;
      }

      const [assignment] = await db
        .insert(userPlanAssignments)
        .values({
          userId: user.id,
          planId: plan.id,
          effectiveFrom: new Date(),
        })
        .returning();

      res.status(201).json({ assignment, plan });
    } catch (error) {
      next(error);
    }
  },
);

// Inspect the currently applied account plan.
app.get("/account/plan", authenticateApiKey, async (req, res, next) => {
  try {
    const account = res.locals.account as { id: string };
    const now = new Date();

    const [assignment] = await db
      .select()
      .from(accountPlanAssignments)
      .where(
        and(
          eq(accountPlanAssignments.accountId, account.id),
          lte(accountPlanAssignments.effectiveFrom, now),
        ),
      )
      .orderBy(desc(accountPlanAssignments.effectiveFrom))
      .limit(1);

    if (!assignment) {
      res.status(404).json({
        error: "No account plan is currently assigned",
      });
      return;
    }

    const [plan] = await db
      .select()
      .from(plans)
      .where(eq(plans.id, assignment.planId))
      .limit(1);

    res.status(200).json({ assignment, plan });
  } catch (error) {
    next(error);
  }
});

// Inspect the currently applied plan for a user in this account.
app.get(
  "/users/:externalId/plan",
  authenticateApiKey,
  async (req, res, next) => {
    try {
      const account = res.locals.account as { id: string };
      const externalId = req.params.externalId;
      const now = new Date();

      if (typeof externalId !== "string") {
        res.status(400).json({
          error: "Invalid externalId",
        });
        return;
      }

      const [user] = await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.accountId, account.id),
            eq(users.externalId, externalId),
          ),
        )
        .limit(1);

      if (!user) {
        res.status(404).json({
          error: "User not found in this account",
        });
        return;
      }

      const [assignment] = await db
        .select()
        .from(userPlanAssignments)
        .where(
          and(
            eq(userPlanAssignments.userId, user.id),
            lte(userPlanAssignments.effectiveFrom, now),
          ),
        )
        .orderBy(desc(userPlanAssignments.effectiveFrom))
        .limit(1);

      if (!assignment) {
        res.status(404).json({
          error: "No user plan is currently assigned",
        });
        return;
      }

      const [plan] = await db
        .select()
        .from(plans)
        .where(eq(plans.id, assignment.planId))
        .limit(1);

      res.status(200).json({ assignment, plan });
    } catch (error) {
      next(error);
    }
  },
);


app.post("/usage/consume", authenticateApiKey, async (req, res, next) => {
  try {
    const account = res.locals.account as { id: string };
    const { externalId, units, requestId } = req.body;

    // Validate request input.
    if (
      typeof externalId !== "string" ||
      externalId.trim().length === 0
    ) {
      res.status(400).json({
        error: "externalId is required",
      });
      return;
    }

    if (!Number.isSafeInteger(units) || units <= 0) {
      res.status(400).json({
        error: "units must be a positive safe integer",
      });
      return;
    }

    if (
      typeof requestId !== "string" ||
      requestId.trim().length === 0 ||
      requestId.length > 255
    ) {
      res.status(400).json({
        error: "requestId is required and must be at most 255 characters",
      });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Lock the account to serialize consumption requests.
      const [lockedAccount] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.id, account.id))
        .for("update");

      if (!lockedAccount) {
        return {
          status: 401,
          body: { error: "Account not found" },
        };
      }

      // Find the user within the authenticated account.
      const [user] = await tx
        .select()
        .from(users)
        .where(
          and(
            eq(users.accountId, account.id),
            eq(users.externalId, externalId.trim()),
          ),
        )
        .limit(1);

      if (!user) {
        return {
          status: 404,
          body: { error: "User not found in this account" },
        };
      }

      // Check whether this request ID has already been processed.
      const [existingRequest] = await tx
        .select()
        .from(usageRequests)
        .where(
          and(
            eq(usageRequests.accountId, account.id),
            eq(usageRequests.requestId, requestId.trim()),
          ),
        )
        .limit(1);

      if (existingRequest) {
        if (
          existingRequest.userId !== user.id ||
          Number(existingRequest.units) !== units
        ) {
          return {
            status: 409,
            body: {
              error: "requestId was already used with different request data",
            },
          };
        }

        return {
          status: existingRequest.status === "ACCEPTED" ? 200 : 429,
          body: {
            requestId: existingRequest.requestId,
            status: existingRequest.status,
            units: Number(existingRequest.units),
            rejectionReason: existingRequest.rejectionReason,
            rejectionScope: existingRequest.rejectionScope,
            idempotent: true,
          },
        };
      }

      const now = new Date();
      const billingMonth = now.toISOString().slice(0, 7);

      // Find the current account plan.
      const [accountAssignment] = await tx
        .select()
        .from(accountPlanAssignments)
        .where(
          and(
            eq(accountPlanAssignments.accountId, account.id),
            lte(accountPlanAssignments.effectiveFrom, now),
          ),
        )
        .orderBy(desc(accountPlanAssignments.effectiveFrom))
        .limit(1);

      if (!accountAssignment) {
        return {
          status: 409,
          body: { error: "No account plan is currently assigned" },
        };
      }

      const [accountPlan] = await tx
        .select()
        .from(plans)
        .where(eq(plans.id, accountAssignment.planId))
        .limit(1);

      if (!accountPlan || accountPlan.type !== "account") {
        return {
          status: 409,
          body: { error: "The assigned account plan is invalid" },
        };
      }

      // Find the current user plan.
      const [userAssignment] = await tx
        .select()
        .from(userPlanAssignments)
        .where(
          and(
            eq(userPlanAssignments.userId, user.id),
            lte(userPlanAssignments.effectiveFrom, now),
          ),
        )
        .orderBy(desc(userPlanAssignments.effectiveFrom))
        .limit(1);

      if (!userAssignment) {
        return {
          status: 409,
          body: { error: "No user plan is currently assigned" },
        };
      }

      const [userPlan] = await tx
        .select()
        .from(plans)
        .where(eq(plans.id, userAssignment.planId))
        .limit(1);

      if (!userPlan || userPlan.type !== "user") {
        return {
          status: 409,
          body: { error: "The assigned user plan is invalid" },
        };
      }

      // Read usage for the current UTC month.
      const [accountUsage] = await tx
        .select()
        .from(accountMonthlyUsage)
        .where(
          and(
            eq(accountMonthlyUsage.accountId, account.id),
            eq(accountMonthlyUsage.billingMonth, billingMonth),
          ),
        )
        .limit(1);

      const [userUsage] = await tx
        .select()
        .from(userMonthlyUsage)
        .where(
          and(
            eq(userMonthlyUsage.userId, user.id),
            eq(userMonthlyUsage.billingMonth, billingMonth),
          ),
        )
        .limit(1);

      const accountConsumed = Number(accountUsage?.consumedUnits ?? 0);
      const userConsumed = Number(userUsage?.consumedUnits ?? 0);

      // Determine whether the request must be rejected.
      let rejectionReason: string | null = null;
      let rejectionScope: string | null = null;

      if (units > accountPlan.maxUnitsPerRequest) {
        rejectionReason = "Account max units per request exceeded";
        rejectionScope = "account";
      } else if (units > userPlan.maxUnitsPerRequest) {
        rejectionReason = "User max units per request exceeded";
        rejectionScope = "user";
      } else if (
        accountConsumed + units > accountPlan.monthlyAllowance
      ) {
        rejectionReason = "Account monthly allowance exceeded";
        rejectionScope = "account";
      } else if (
        userConsumed + units > userPlan.monthlyAllowance
      ) {
        rejectionReason = "User monthly allowance exceeded";
        rejectionScope = "user";
      }

      // Record rejected requests without updating usage.
      if (rejectionReason !== null) {
        const [savedRequest] = await tx
          .insert(usageRequests)
          .values({
            accountId: account.id,
            userId: user.id,
            requestId: requestId.trim(),
            units,
            status: "REJECTED",
            rejectionReason,
            rejectionScope,
          })
          .returning();

        if (!savedRequest) {
          throw new Error("Failed to save rejected usage request");
        }

        return {
          status: 429,
          body: {
            requestId: savedRequest.requestId,
            status: savedRequest.status,
            units,
            rejectionReason: savedRequest.rejectionReason,
            rejectionScope: savedRequest.rejectionScope,
            billingMonth,
            accountConsumed,
            userConsumed,
          },
        };
      }

      // Increase account usage atomically.
      await tx
        .insert(accountMonthlyUsage)
        .values({
          accountId: account.id,
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

      // Increase user usage atomically.
      await tx
        .insert(userMonthlyUsage)
        .values({
          userId: user.id,
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

      // Record the accepted request.
      const [savedRequest] = await tx
        .insert(usageRequests)
        .values({
          accountId: account.id,
          userId: user.id,
          requestId: requestId.trim(),
          units,
          status: "ACCEPTED",
          rejectionReason: null,
          rejectionScope: null,
        })
        .returning();

      if (!savedRequest) {
        throw new Error("Failed to save accepted usage request");
      }

      return {
        status: 200,
        body: {
          requestId: savedRequest.requestId,
          status: savedRequest.status,
          units,
          billingMonth,
          accountConsumed: accountConsumed + units,
          userConsumed: userConsumed + units,
          accountRemaining:
            accountPlan.monthlyAllowance - accountConsumed - units,
          userRemaining:
            userPlan.monthlyAllowance - userConsumed - units,
          idempotent: false,
        },
      };
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

async function main() {
  try {
    await migrate(db, {
      migrationsFolder: "./src/db/migrations",
    });

    console.log("Migrations completed successfully!");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Application startup failed:", error);
  }
}

main();
