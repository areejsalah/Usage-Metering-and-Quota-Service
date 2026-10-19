
import { createUser, getUserByExternalId, } from "../db/queries/users.js";
import { db } from "../db/index.js";

import type { Request, Response, NextFunction } from "express";

export async function handlerCreateUser(
  req: Request,
  res: Response,
  next: NextFunction,
) {
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

    const existingUser = await getUserByExternalId(
      db,
      account.id,
      normalizedExternalId,
    );

    if (existingUser) {
      res.status(409).json({
        error: "User already exists for this account",
      });
      return;
    }

    const user = await createUser(
      account.id,
      normalizedExternalId,
    );

    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
}