import { db } from "../db/index.js";
import type { Request, Response, NextFunction } from "express";
import { createAccountPlanAssignment, createUserPlanAssignment, getCurrentAccountPlanAssignment, getCurrentUserPlanAssignment } from "../db/queries/assignments.js";
import { createPlan, getAvailablePlans, getPlanById, updatePlan } from "../db/queries/plans.js";
import { getUserByExternalId } from "../db/queries/users.js";


export async function handlerCreatePlan(req: Request, res: Response, next: NextFunction){
     try {
    const account = res.locals.account as { id: string };
    const {
      name,
      type,
      monthlyAllowance,
      maxUnitsPerRequest,
    } = req.body;

    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({
        error: "A non-empty name is required",
      });
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

    const plan = await createPlan(
      name.trim(),
      type,
      monthlyAllowance,
      maxUnitsPerRequest,
      account.id,
    );

    res.status(201).json({ plan });
  } catch (error) {
    next(error);
  }
}

export async function handlerUpdatePlan(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const account = res.locals.account as { id: string };
    const planId = req.params.planId;

    if (typeof planId !== "string" || planId.trim().length === 0) {
      res.status(400).json({ error: "A valid planId is required" });
      return;
    }

    const currentPlan = await getPlanById(db, planId);

    if (
      !currentPlan ||
      currentPlan.accountId !== account.id ||
      currentPlan.isPredefined
    ) {
      res.status(404).json({
        error: "Custom plan not found in this account",
      });
      return;
    }

    const {
      name,
      monthlyAllowance,
      maxUnitsPerRequest,
    } = req.body;

    if (
      name === undefined &&
      monthlyAllowance === undefined &&
      maxUnitsPerRequest === undefined
    ) {
      res.status(400).json({
        error: "At least one plan field must be provided",
      });
      return;
    }

    if (
      name !== undefined &&
      (typeof name !== "string" || name.trim().length === 0)
    ) {
      res.status(400).json({
        error: "name must be a non-empty string",
      });
      return;
    }

    if (
      monthlyAllowance !== undefined &&
      (!Number.isSafeInteger(monthlyAllowance) || monthlyAllowance <= 0)
    ) {
      res.status(400).json({
        error: "monthlyAllowance must be a positive safe integer",
      });
      return;
    }

    if (
      maxUnitsPerRequest !== undefined &&
      (!Number.isSafeInteger(maxUnitsPerRequest) ||
        maxUnitsPerRequest <= 0)
    ) {
      res.status(400).json({
        error: "maxUnitsPerRequest must be a positive safe integer",
      });
      return;
    }

    const updatedPlan = await updatePlan(
      planId,
      account.id,
      name === undefined ? currentPlan.name : name.trim(),
      monthlyAllowance === undefined
        ? currentPlan.monthlyAllowance
        : monthlyAllowance,
      maxUnitsPerRequest === undefined
        ? currentPlan.maxUnitsPerRequest
        : maxUnitsPerRequest,
    );

    if (!updatedPlan) {
      res.status(404).json({
        error: "Custom plan not found in this account",
      });
      return;
    }

    res.status(200).json({ plan: updatedPlan });
  } catch (error) {
    next(error);
  }
}

export async function handlerGetPlans(req: Request, res: Response, next: NextFunction) {
    try {
    const account = res.locals.account as { id: string };

    const availablePlans = await getAvailablePlans(account.id);

    res.status(200).json({
      plans: availablePlans,
    });
  } catch (error) {
    next(error);
  }
}

export async function handlerAssignAccountPlan(req: Request, res: Response, next: NextFunction) {
    try {
      const account = res.locals.account as { id: string };
      const { planId } = req.body;

      if (typeof planId !== "string") {
        res.status(400).json({
          error: "planId is required",
        });
        return;
      }

      const plan = await getPlanById(db, planId);

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

      const assignment = await createAccountPlanAssignment(
        account.id,
        plan.id,
     );

      res.status(201).json({
        assignment,
        plan,
      });
    } catch (error) {
      next(error);
    }
  
}
export async function handlerAssignUserPlan(req: Request, res: Response, next: NextFunction) {
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
        res.status(400).json({
          error: "planId is required",
        });
        return;
      }

      const user = await getUserByExternalId(
        db,
        account.id,
        externalId,
      );

      if (!user) {
        res.status(404).json({
          error: "User not found in this account",
        });
        return;
      }

      const plan = await getPlanById(db,planId);

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

      const assignment = await createUserPlanAssignment(
        user.id,
        plan.id,
  
      );

      res.status(201).json({
        assignment,
        plan,
      });
    } catch (error) {
      next(error);
    }
  
}

export async function handlerGetCurrentAccountPlan(req: Request, res: Response, next: NextFunction){
    try {
      const account = res.locals.account as { id: string };
      const now = new Date();

      const assignment = await getCurrentAccountPlanAssignment(
        db,
        account.id,
        now,
      );

      if (!assignment) {
        res.status(404).json({
          error: "No account plan is currently assigned",
        });
        return;
      }

      const plan = await getPlanById(db,assignment.planId);

      res.status(200).json({
        assignment,
        plan,
      });
    } catch (error) {
      next(error);
    }
  
}

export async function handlerGetCurrentUserPlan(req: Request, res: Response, next: NextFunction) {
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

      const user = await getUserByExternalId(
        db,
        account.id,
        externalId,
      );

      if (!user) {
        res.status(404).json({
          error: "User not found in this account",
        });
        return;
      }

      const assignment = await getCurrentUserPlanAssignment(
        db,
        user.id,
        now,
      );

      if (!assignment) {
        res.status(404).json({
          error: "No user plan is currently assigned",
        });
        return;
      }

      const plan = await getPlanById(db,assignment.planId);

      res.status(200).json({
        assignment,
        plan,
      });
    } catch (error) {
      next(error);
    }
  
} 


