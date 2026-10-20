import { handlerCreateUser } from "./handlers/users.js"
import { handlerCreateAccount } from "./handlers/accounts.js"
import express from "express";
import type { Request, Response, } from "express";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db } from "./db/index.js";
import { authenticateApiKey } from "./auth.js";

import { handlerConsumeUsage, handlerGetAccountUsage, handlerGetUserUsage,  handlerGetUsageHistory,} from "./handlers/usage.js";
import { handlerCreatePlan, handlerGetPlans, handlerAssignAccountPlan, 
  handlerAssignUserPlan, handlerGetCurrentAccountPlan, handlerGetCurrentUserPlan,
  handlerUpdatePlan} from "./handlers/plans.js"




const app = express();
const PORT = 3000;

app.use(express.json());

function handlerReadiness(_req: Request, res: Response)  {
  res.status(200).json({
    status: "ok",
    message: "Usage Metering Service is running",
  });
};




app.post("/plans", authenticateApiKey, handlerCreatePlan);
app.get("/plans", authenticateApiKey, handlerGetPlans);
app.post("/account/plan", authenticateApiKey, handlerAssignAccountPlan);
app.post("/users/:externalId/plan", authenticateApiKey, handlerAssignUserPlan);

app.get("/account/plan", authenticateApiKey, handlerGetCurrentAccountPlan);
app.get("/users/:externalId/plan", authenticateApiKey, handlerGetCurrentUserPlan);
app.post("/usage/consume", authenticateApiKey, handlerConsumeUsage);
app.get("/account/usage", authenticateApiKey, handlerGetAccountUsage);
app.get("/users/:externalId/usage", authenticateApiKey, handlerGetUserUsage,);
app.get("/usage/history", authenticateApiKey,  handlerGetUsageHistory,);
app.post("/users", authenticateApiKey, handlerCreateUser);
app.get("/health", handlerReadiness);
app.post("/accounts", handlerCreateAccount);

app.patch("/plans/:planId", authenticateApiKey, handlerUpdatePlan);

async function main() {
  try {
    await migrate(db, {
      migrationsFolder: "./src/db/migrations",
    });

    console.log("Migrations completed successfully!");

    app.listen(PORT, () => {
      console.log(
        `Server is running on port ${PORT}`,
      );
    });
  } catch (error) {
    console.error(
      "Application startup failed:",
      error,
    );
  }
}

main();
