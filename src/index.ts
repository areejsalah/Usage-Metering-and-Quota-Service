import { db } from "./db/index.js";
import express from "express";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Usage Metering Service is running",
  });
});

async function main() {
  try {
    // await db.query("SELECT NOW()");
    // console.log("Database connected successfully!");

    await migrate(db, {
      migrationsFolder: "./src/db/migrations",
    });

    console.log("Migrations completed successfully!");

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Application startup failed:", error);
    // process.exit(1);
  }
}
main();
