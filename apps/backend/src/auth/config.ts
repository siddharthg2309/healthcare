import { betterAuth } from "better-auth";
import { pool } from "@healthcare/database";
import { env, trustedOrigins } from "../env.js";

export const auth = betterAuth({
  database: pool,
  secret: env.AUTH_SECRET,
  baseURL: env.AUTH_BASE_URL,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
});
