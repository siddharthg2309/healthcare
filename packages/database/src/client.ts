import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to connect to Neon Postgres.");
}

export const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: process.env.NODE_ENV === "test",
});

pool.on("error", () => {
  console.error("Unexpected idle database connection error.");
});

export const db = drizzle(pool, { schema });
