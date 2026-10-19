
import type { Request, Response, NextFunction } from "express";
import { createAccount, } from "../db/queries/accounts.js";
import { randomBytes, createHash } from "node:crypto";

export async function handlerCreateAccount(req: Request, res: Response, next: NextFunction) {
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

    const account = await createAccount(
      name.trim(),
      apiKeyHash,
    );

    res.status(201).json({
      account,
      apiKey,
    });
  } catch (error) {
    next(error);
  }
}
