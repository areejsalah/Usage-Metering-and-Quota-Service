import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 8080),
  database: process.env.DB_NAME ?? "usage_metering",
  user: process.env.DB_USER ?? "postgres",
  password: process.env.DB_PASSWORD ?? "postgres",
});
export const db = drizzle(pool);
