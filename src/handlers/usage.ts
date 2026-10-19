import { db } from "../db/index.js";
import { getCurrentAccountPlanAssignment, getCurrentUserPlanAssignment } from "../db/queries/assignments.js";
import { getPlanById } from "../db/queries/plans.js";
import { getAccountMonthlyUsage, getUserMonthlyUsage, incrementAccountMonthlyUsage, incrementUserMonthlyUsage } from "../db/queries/usage.js";
import { createUsageRequest, getUsageRequestByRequestId, getUsageRequestHistory } from "../db/queries/usageRequests.js";
import {  eq, } from "drizzle-orm";


import { getUserByExternalId, } from "../db/queries/users.js";

import type { Request, Response, NextFunction } from "express";
import { accounts } from "../db/schema.js";

export async function handlerConsumeUsage(req: Request, res: Response, next: NextFunction) {
     try {
      const account = res.locals.account as { id: string };
      const { externalId, units, requestId } = req.body;

      if (
        typeof externalId !== "string" ||
        externalId.trim().length === 0
      ) {
        res.status(400).json({ error: "externalId is required" });
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
          error:
            "requestId is required and must be at most 255 characters",
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
        const user = await getUserByExternalId(
          tx,
          account.id,
          externalId.trim(),
        );

        if (!user) {
          return {
            status: 404,
            body: { error: "User not found in this account" },
          };
        }

        // Check whether this request ID has already been processed.
        const existingRequest = await getUsageRequestByRequestId(
          tx,
          account.id,
          requestId.trim(),
        );

        if (existingRequest) {
          if (
            existingRequest.userId !== user.id ||
            Number(existingRequest.units) !== units
          ) {
            return {
              status: 409,
              body: {
                error:
                  "requestId was already used with different request data",
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
        const accountAssignment =
          await getCurrentAccountPlanAssignment(tx,account.id, now);

        if (!accountAssignment) {
          return {
            status: 409,
            body: { error: "No account plan is currently assigned" },
          };
        }

        const accountPlan = await getPlanById(
          tx,
          accountAssignment.planId,
        );

        if (!accountPlan || accountPlan.type !== "account") {
          return {
            status: 409,
            body: { error: "The assigned account plan is invalid" },
          };
        }

        // Find the current user plan.
        const userAssignment = await getCurrentUserPlanAssignment(
          tx,
          user.id,
          now,
        );

        if (!userAssignment) {
          return {
            status: 409,
            body: { error: "No user plan is currently assigned" },
          };
        }

        const userPlan = await getPlanById(tx,userAssignment.planId);

        if (!userPlan || userPlan.type !== "user") {
          return {
            status: 409,
            body: { error: "The assigned user plan is invalid" },
          };
        }

        // Read usage for the current UTC month.
        const accountUsage = await getAccountMonthlyUsage(
          tx,
          account.id,
          billingMonth,
        );

        const userUsage = await getUserMonthlyUsage(
          tx,
          user.id,
          billingMonth,
        );

        const accountConsumed = Number(
          accountUsage?.consumedUnits ?? 0,
        );

        const userConsumed = Number(
          userUsage?.consumedUnits ?? 0,
        );

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
          const savedRequest = await createUsageRequest(
            tx,
            account.id,
            user.id,
            requestId.trim(),
            units,
            "REJECTED",
            rejectionReason,
            rejectionScope,
          );

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
        await incrementAccountMonthlyUsage(
          tx,
          account.id,
          billingMonth,
          units,
          now,
        );

        // Increase user usage atomically.
        await incrementUserMonthlyUsage(
          tx,
          user.id,
          billingMonth,
          units,
          now,
        );

        // Record the accepted request.
        const savedRequest = await createUsageRequest(
          tx,
          account.id,
          user.id,
          requestId.trim(),
          units,
          "ACCEPTED",
          null,
          null,
        );

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
              accountPlan.monthlyAllowance -
              accountConsumed -
              units,
            userRemaining:
              userPlan.monthlyAllowance -
              userConsumed -
              units,
            idempotent: false,
          },
        };
      });

      res.status(result.status).json(result.body);
    } catch (error) {
      next(error);
    }
  
}



export async function handlerGetAccountUsage(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const account = res.locals.account as { id: string };

    const monthParam = req.query.month;
    const billingMonth =
      typeof monthParam === "string"
        ? monthParam
        : new Date().toISOString().slice(0, 7);

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingMonth)) {
      res.status(400).json({
        error: "month must be in YYYY-MM format",
      });
      return;
    }

    const year = Number(billingMonth.slice(0, 4));
    const month = Number(billingMonth.slice(5, 7));

    const monthEnd = new Date(
      Date.UTC(year, month, 0, 23, 59, 59, 999),
    );

    const assignment = await getCurrentAccountPlanAssignment(
      db,
      account.id,
      monthEnd,
    );

    if (!assignment) {
      res.status(404).json({
        error: "No account plan was assigned for this month",
      });
      return;
    }

    const plan = await getPlanById(db, assignment.planId);

    if (!plan || plan.type !== "account") {
      res.status(409).json({
        error: "The assigned account plan is invalid",
      });
      return;
    }

    const usage = await getAccountMonthlyUsage(
      db,
      account.id,
      billingMonth,
    );

    const consumedUnits = Number(usage?.consumedUnits ?? 0);
    const remainingUnits = Math.max(
      0,
      plan.monthlyAllowance - consumedUnits,
    );

    res.status(200).json({
      billingMonth,
      consumedUnits,
      monthlyAllowance: plan.monthlyAllowance,
      remainingUnits,
    });
  } catch (error) {
    next(error);
  }
}


export async function handlerGetUserUsage(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const account = res.locals.account as { id: string };
    const externalId = req.params.externalId;

    if (
      typeof externalId !== "string" ||
      externalId.trim().length === 0
    ) {
      res.status(400).json({
        error: "A valid externalId is required",
      });
      return;
    }

    const monthParam = req.query.month;
    const billingMonth =
      typeof monthParam === "string"
        ? monthParam
        : new Date().toISOString().slice(0, 7);

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingMonth)) {
      res.status(400).json({
        error: "month must be in YYYY-MM format",
      });
      return;
    }

    const user = await getUserByExternalId(
      db,
      account.id,
      externalId.trim(),
    );

    if (!user) {
      res.status(404).json({
        error: "User not found in this account",
      });
      return;
    }

    const [year, month] = [
      Number(billingMonth.slice(0, 4)),
      Number(billingMonth.slice(5, 7)),
    ];

    const monthEnd = new Date(
      Date.UTC(year, month, 0, 23, 59, 59, 999),
    );

    const assignment = await getCurrentUserPlanAssignment(
      db,
      user.id,
      monthEnd,
    );

    if (!assignment) {
      res.status(404).json({
        error: "No user plan was assigned for this month",
      });
      return;
    }

    const plan = await getPlanById(db, assignment.planId);

    if (!plan || plan.type !== "user") {
      res.status(409).json({
        error: "The assigned user plan is invalid",
      });
      return;
    }

    const usage = await getUserMonthlyUsage(
      db,
      user.id,
      billingMonth,
    );

    const consumedUnits = Number(usage?.consumedUnits ?? 0);
    const remainingUnits = Math.max(
      0,
      plan.monthlyAllowance - consumedUnits,
    );

    res.status(200).json({
      externalId: user.externalId,
      billingMonth,
      consumedUnits,
      monthlyAllowance: plan.monthlyAllowance,
      remainingUnits,
    });
  } catch (error) {
    next(error);
  }
}


export async function handlerGetUsageHistory(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const account = res.locals.account as { id: string };

    const limitParam = req.query.limit ?? "20";
    const offsetParam = req.query.offset ?? "0";

    if (
      typeof limitParam !== "string" ||
      !/^\d+$/.test(limitParam) ||
      !Number.isSafeInteger(Number(limitParam)) ||
      Number(limitParam) < 1 ||
      Number(limitParam) > 100
    ) {
      res.status(400).json({
        error: "limit must be an integer between 1 and 100",
      });
      return;
    }

    if (
      typeof offsetParam !== "string" ||
      !/^\d+$/.test(offsetParam) ||
      !Number.isSafeInteger(Number(offsetParam))
    ) {
      res.status(400).json({
        error: "offset must be a non-negative integer",
      });
      return;
    }

    const limit = Number(limitParam);
    const offset = Number(offsetParam);

    const requests = await getUsageRequestHistory(
      db,
      account.id,
      limit,
      offset,
    );

    res.status(200).json({
      limit,
      offset,
      requests,
    });
  } catch (error) {
    next(error);
  }
}

