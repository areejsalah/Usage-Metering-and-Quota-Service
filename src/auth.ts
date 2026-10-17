
import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { accounts } from "./db/schema.js";

export const authenticateApiKey: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    const apiKey = req.header("x-api-key");

    if (!apiKey) {
      res.status(401).json({
        error: "API key is required",
      });
      return;
    }

    const apiKeyHash = createHash("sha256")
      .update(apiKey)
      .digest("hex");

    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.apiKeyHash, apiKeyHash))
      .limit(1);

    if (!account) {
      res.status(401).json({
        error: "Invalid API key",
      });
      return;
    }

    res.locals.account = account;
    next();
  } catch (error) {
    next(error);
  }
};

