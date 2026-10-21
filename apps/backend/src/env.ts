import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const optionalText = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);
const optionalSecret = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(32).optional(),
);
const optionalUrl = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().url().optional(),
);
const optionalEncryptionKey = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(8787),
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  AUTH_BASE_URL: z.string().url(),
  AUTH_TRUSTED_ORIGINS: z.string().optional(),
  JOB_DISPATCH_SECRET: optionalSecret,
  OPENROUTER_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("minimax/minimax-m3"),
  AI_USER_DAILY_OPERATION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  GOOGLE_CLIENT_ID: optionalText,
  GOOGLE_CLIENT_SECRET: optionalText,
  GOOGLE_REDIRECT_URI: optionalUrl,
  TOKEN_ENCRYPTION_KEY: optionalEncryptionKey,
});

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  const invalidNames = parsedEnvironment.error.issues
    .map((issue) => issue.path.join("."))
    .join(", ");
  throw new Error(`Invalid backend environment configuration: ${invalidNames}`);
}

export const env = parsedEnvironment.data;

const configuredOrigins = env.AUTH_TRUSTED_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean) ?? [];

export const trustedOrigins = [
  "healthcare://",
  "healthcare://*",
  ...configuredOrigins,
  ...(env.NODE_ENV === "development" ? ["exp://", "exp://**"] : []),
];

export function isAllowedWebOrigin(origin: string): boolean {
  if (configuredOrigins.includes(origin)) return true;
  if (env.NODE_ENV !== "development") return false;
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}
