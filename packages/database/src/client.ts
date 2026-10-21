import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

function explicitTlsMode(connectionString: string): string {
  const parsed = new URL(connectionString);
  const currentAliases = new Set(["prefer", "require", "verify-ca"]);
  const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
  if (sslMode && currentAliases.has(sslMode)) {
    parsed.searchParams.set("sslmode", "verify-full");
  }
  return parsed.toString();
}

const configuredConnectionString = process.env.DATABASE_URL;

if (!configuredConnectionString) {
  throw new Error("DATABASE_URL is required to connect to Neon Postgres.");
}

const connectionString = explicitTlsMode(configuredConnectionString);

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
