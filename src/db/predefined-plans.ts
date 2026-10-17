
import { and, eq } from "drizzle-orm";
import { db, pool } from "./index.js";
import { plans } from "./schema.js";

const predefinedPlans = [
  {
    name: "Starter",
    type: "account",
    monthlyAllowance: 100_000,
    maxUnitsPerRequest: 10_000,
    isPredefined: true,
    accountId: null,
  },
  {
    name: "Pro",
    type: "account",
    monthlyAllowance: 1_000_000,
    maxUnitsPerRequest: 100_000,
    isPredefined: true,
    accountId: null,
  },
  {
    name: "Basic",
    type: "user",
    monthlyAllowance: 10_000,
    maxUnitsPerRequest: 1_000,
    isPredefined: true,
    accountId: null,
  },
  {
    name: "Premium",
    type: "user",
    monthlyAllowance: 100_000,
    maxUnitsPerRequest: 10_000,
    isPredefined: true,
    accountId: null,
  },
];

async function createPredefinedPlans() {
  try {
    for (const plan of predefinedPlans) {
      const existingPlan = await db
        .select({ id: plans.id })
        .from(plans)
        .where(
          and(
            eq(plans.name, plan.name),
            eq(plans.type, plan.type),
            eq(plans.isPredefined, true),
          ),
        )
        .limit(1);

      if (existingPlan.length === 0) {
        await db.insert(plans).values(plan);
        console.log(`Created predefined plan: ${plan.name}`);
      } else {
        console.log(`Predefined plan already exists: ${plan.name}`);
      }
    }

    console.log("Predefined plans processed successfully.");
  } catch (error) {
    console.error("Failed to create predefined plans:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

createPredefinedPlans();
