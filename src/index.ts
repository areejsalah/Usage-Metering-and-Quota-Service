import { db } from "./db/index.js";
import express from "express";

const app = express();
const PORT = 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Usage Metering Service is running",
  });
});

app.listen(PORT,  async () => {
  console.log(`Server is running on http://localhost:${PORT}`);

  try {
    await db.query("SELECT NOW()");
      console.log("Database connected successfully!");
    } catch (error) {
      console.error("Database connection failed:", error);
  }
});
