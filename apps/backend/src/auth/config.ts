import { betterAuth } from "better-auth";
import { pool } from "@healthcare/database";
import { env, trustedOrigins } from "../env.js";
import { cleanupBeforeAccountDeletion } from "../services/account-privacy.js";

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
  socialProviders: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  user: {
    validateUserInfo: async ({ user, source }) => {
      if (source.method !== "oauth" || source.oauth?.providerId !== "google") return;

      const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
      if (!email || user.emailVerified !== true) {
        return {
          error: "google_email_unverified",
          errorDescription: "Use a Google account with a verified email address.",
        };
      }
    },
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => cleanupBeforeAccountDeletion(user.id),
    },
  },
});
