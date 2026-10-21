import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { createMiddleware } from "hono/factory";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { db } from "@healthcare/database";
import { aiRuns, calendarEventLinks, catalogFoods, catalogFoodPortions, catalogFoodSafetyReviews, foodDayStatuses, foodFavorites, foodPortions, googleCalendarConnections, googleOauthStates, plans, privateUploads, reminderPreferences as reminderPreferencesTable, syncChanges, userFoodRecipeVersions, userFoods, userProfiles, userRecords, userSyncCounters } from "@healthcare/database/schema";
import {
  approveMealPlanRequestSchema,
  approveWorkoutPlanRequestSchema,
  activityLogRecordSchema,
  acceptGoalRequestSchema,
  deleteAccountRequestSchema,
  createActivityLogRequestSchema,
  createCustomFoodRequestSchema,
  createFoodPortionRequestSchema,
  createFoodLogRequestSchema,
  copyFoodLogsRequestSchema,
  createFoodRecipeRequestSchema,
  createWorkoutPlanRequestSchema,
  createMeasurementRequestSchema,
  deleteActivityLogRequestSchema,
  deleteFoodLogRequestSchema,
  exerciseProgressQuerySchema,
  foodPhotoRecognitionRequestSchema,
  foodTextEstimateRequestSchema,
  confirmFoodPhotoRequestSchema,
  setFoodFavoriteRequestSchema,
  foodDayStatusRequestSchema,
  foodLogRecordSchema,
  weeklyProgressReviewResponseSchema,
  goalProposalRequestSchema,
  goalSchema,
  mealPlanDataSchema,
  mealPlanEditRequestSchema,
  mealPlanRunRequestSchema,
  workoutPlanRunRequestSchema,
  profileSchema,
  reminderPreferencesRequestSchema,
  reminderPreferencesResponseSchema,
  syncPullQuerySchema,
  syncPushSchema,
  updateWorkoutPlanRequestSchema,
  updateActivityLogRequestSchema,
  updateFoodLogRequestSchema,
  updateFoodRecipeRequestSchema,
  workoutPlanDataSchema,
  type GoalRecord,
  type WeeklyProgressReviewResponse,
  type WorkoutPlanData,
} from "@healthcare/contracts";
import {
  buildGoalProposal,
  isActivityEnergyKindAllowed,
  summarizeActivityEnergy,
  deriveMealPlanFoodSafetyRequirements,
  findExerciseById,
  isFoodAllowedByReviewedMetadata,
  type FoodSafetyMetadata,
  type FoodSafetyRequirements,
} from "@healthcare/domain";
import { auth } from "./auth/config.js";
import { env, isAllowedWebOrigin } from "./env.js";
import { redeemInvitation, releaseInvitation, reserveInvitation } from "./auth/invitations.js";
import { claimJobs, completeJob, failJob } from "./services/jobs.js";
import { FoodVisionError } from "./services/food-vision.js";
import { createFoodEstimate, SAVED_AI_FOOD_PREFIX } from "./services/food-estimation.js";
import { buildPhotoFoodRecords, readFoodPhotoDraft } from "./services/food-photo-draft.js";
import { buildActivityEnergyEstimate, createActivityEnergyEstimator } from "./services/activity-energy.js";
import { hasAiOperationCapacity, lockAiUsageWindow } from "./services/ai-usage.js";
import { buildMealPlanningContext, hashMealPlanningContext, mealPlanningVersions, recalculateMealPlanEdit, resumeMealPlan, runMealPlan } from "./services/meal-planning.js";
import { buildWorkoutPlanningContext, hashWorkoutPlanningContext, resumeWorkoutPlan, runWorkoutPlan, workoutPlanningVersions } from "./services/workout-planning.js";
import { pullSync, pushSync } from "./services/sync.js";
import { syncApprovedWorkoutCalendar } from "./services/calendar-sync.js";
import { assertAccountDeletionReady, exportAccountData } from "./services/account-privacy.js";
import {
  createGoalHealthCalendar,
  createGoogleAuthorizationUrl,
  decryptGoogleRefreshToken,
  encryptGoogleRefreshToken,
  exchangeGoogleCode,
  googleCalendarConfigured,
  GoogleCalendarError,
  hashOAuthState,
  makeOAuthState,
  revokeGoogleRefreshToken,
} from "./services/google-calendar.js";

type AuthSession = typeof auth.$Infer.Session;
type BackendEnv = { Variables: { session: AuthSession } };

const app = new Hono<BackendEnv>();

app.use("/api/*", cors({
  origin: (origin) => isAllowedWebOrigin(origin) ? origin : undefined,
  allowHeaders: ["Content-Type", "Cookie", "Authorization", "x-invitation-code", "x-job-dispatch-secret"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
}));

app.get("/health", (c) => c.json({ status: "ok" }));

app.all("/api/auth/sign-up/email", async (c) => {
  let body: { email?: unknown };
  try {
    body = await c.req.raw.clone().json() as { email?: unknown };
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const inviteCode = c.req.header("x-invitation-code")?.trim() ?? "";
  if (!email || !inviteCode) return c.json({ error: "invitation_required" }, 403);

  let invitationId: string | null;
  try {
    invitationId = await reserveInvitation(inviteCode, email);
  } catch {
    return c.json({ error: "invitation_unavailable" }, 503);
  }
  if (!invitationId) return c.json({ error: "invitation_invalid_or_expired" }, 403);

  try {
    const response = await auth.handler(c.req.raw);
    if (response.ok) {
      let userId: string | undefined;
      try {
        const responseBody = await response.clone().json() as { user?: { id?: string } };
        userId = responseBody.user?.id;
      } catch {
        // A successful auth response still consumes the invite if the response body changes.
      }
      await redeemInvitation(invitationId, userId);
    } else {
      await releaseInvitation(invitationId);
    }
    return response;
  } catch {
    await releaseInvitation(invitationId);
    return c.json({ error: "signup_failed" }, 500);
  }
});

app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

app.get("/v1/auth/providers", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) });
});

const requireSession = createMiddleware<BackendEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("session", session);
  await next();
});

app.use("/v1/*", requireSession);
app.use("/v1/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store, max-age=0");
  c.header("Pragma", "no-cache");
});

function nutritionValue(value: string | number): number {
  return Number(value);
}

function roundNutrition(value: number): number {
  return Math.round(value * 100) / 100;
}

type RecipeComposition = {
  yieldGrams: number;
  instructions?: string[];
  ingredients: Array<{
    foodId: string;
    foodSource: "shared_catalog" | "personal";
    foodName: string;
    quantityGrams: number;
    nutritionPer100g: { caloriesKcal: number; proteinG: number; carbohydrateG: number; fatG: number };
  }>;
};

function sameRecipeComposition(left: RecipeComposition | null | undefined, right: RecipeComposition): boolean {
  if (!left || left.yieldGrams !== right.yieldGrams) return false;
  const ingredientKey = (ingredient: RecipeComposition["ingredients"][number]) => [
    ingredient.foodId,
    ingredient.foodSource,
    ingredient.foodName,
    ingredient.quantityGrams,
    ingredient.nutritionPer100g.caloriesKcal,
    ingredient.nutritionPer100g.proteinG,
    ingredient.nutritionPer100g.carbohydrateG,
    ingredient.nutritionPer100g.fatG,
  ];
  return JSON.stringify(left.instructions ?? []) === JSON.stringify(right.instructions ?? [])
    && JSON.stringify(left.ingredients.map(ingredientKey)) === JSON.stringify(right.ingredients.map(ingredientKey));
}

function localDateInZone(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function localDateTimeAtTargetInZone(value: string, targetDate: string, timezone: string): string | null {
  const source = new Date(value);
  if (!Number.isFinite(source.getTime())) return null;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const sourceParts = formatter.formatToParts(source);
  const readPart = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? NaN);
  const hour = readPart(sourceParts, "hour");
  const minute = readPart(sourceParts, "minute");
  const second = readPart(sourceParts, "second");
  const [year = NaN, month = NaN, day = NaN] = targetDate.split("-").map(Number);
  const milliseconds = source.getUTCMilliseconds();
  const targetWallTime = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds);
  let candidate = targetWallTime;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = formatter.formatToParts(new Date(candidate));
    const representedWallTime = Date.UTC(
      readPart(parts, "year"), readPart(parts, "month") - 1, readPart(parts, "day"),
      readPart(parts, "hour"), readPart(parts, "minute"), readPart(parts, "second"), milliseconds,
    );
    const offset = representedWallTime - candidate;
    const adjusted = targetWallTime - offset;
    if (adjusted === candidate) break;
    candidate = adjusted;
  }
  const check = formatter.formatToParts(new Date(candidate));
  const expected = { year, month, day, hour, minute, second };
  if (Object.entries(expected).some(([key, expectedValue]) =>
    readPart(check, key as Intl.DateTimeFormatPartTypes) !== expectedValue)) return null;
  return new Date(candidate).toISOString();
}

function shiftLocalDate(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function goalWeightAt(goal: GoalRecord, date: string): number {
  const points = goal.trajectory;
  const before = [...points].reverse().find((point) => point.date <= date);
  const after = points.find((point) => point.date >= date);
  if (!before) return points[0]?.targetWeightKg ?? goal.startWeightKg;
  if (!after || after.date === before.date) return before.targetWeightKg;
  const elapsed = Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${before.date}T00:00:00.000Z`);
  const span = Date.parse(`${after.date}T00:00:00.000Z`) - Date.parse(`${before.date}T00:00:00.000Z`);
  return before.targetWeightKg + (after.targetWeightKg - before.targetWeightKg) * (span > 0 ? elapsed / span : 0);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] ?? null : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

function daySpan(firstDate: string, lastDate: string): number {
  return Math.max(0, Math.round((Date.parse(`${lastDate}T00:00:00.000Z`) - Date.parse(`${firstDate}T00:00:00.000Z`)) / 86_400_000));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasValidPlanExercises(data: WorkoutPlanData): boolean {
  return data.sessions.every((session) => session.exercises.every((target) => {
    const exercise = findExerciseById(target.exerciseId);
    return exercise !== undefined && exercise.trackingMode === target.trackingMode;
  }));
}

function workoutPlanResponse(row: typeof plans.$inferSelect) {
  const data = workoutPlanDataSchema.safeParse(row.data);
  if (!data.success || !["template", "manual", "ai"].includes(row.source)) return null;
  return {
    id: row.id,
    groupId: row.groupId,
    kind: row.kind,
    version: row.version,
    editVersion: row.editVersion,
    status: row.status,
    source: row.source as "template" | "manual" | "ai",
    data: data.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
  };
}

async function hasOwnedApprovedWorkoutSession(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  reference: { planId: string; planVersion: number; weekday: number; label: string },
): Promise<boolean> {
  const [plan] = await tx.select().from(plans).where(and(
    eq(plans.userId, userId), eq(plans.id, reference.planId), eq(plans.kind, "workout"),
  )).limit(1);
  if (!plan || !["active", "superseded"].includes(plan.status) || plan.version !== reference.planVersion) return false;
  const data = workoutPlanDataSchema.safeParse(plan.data);
  return data.success && data.data.sessions.some((session) =>
    session.weekday === reference.weekday && session.label === reference.label);
}

function mealPlanResponse(row: typeof plans.$inferSelect) {
  const data = mealPlanDataSchema.safeParse(row.data);
  if (!data.success || !["template", "manual", "ai"].includes(row.source)) return null;
  return {
    id: row.id,
    groupId: row.groupId,
    kind: row.kind,
    version: row.version,
    editVersion: row.editVersion,
    status: row.status,
    source: row.source as "template" | "manual" | "ai",
    data: data.data,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
  };
}

async function appendSyncChange(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  entity: "food_log" | "activity_log",
  recordId: string,
  data: Record<string, unknown> | null,
  version = 1,
  deleted = false,
) {
  await tx.insert(userSyncCounters).values({ userId, cursor: 0 }).onConflictDoNothing();
  const [counter] = await tx.update(userSyncCounters).set({
    cursor: sql`${userSyncCounters.cursor} + 1`,
  }).where(eq(userSyncCounters.userId, userId)).returning({ cursor: userSyncCounters.cursor });
  if (!counter) throw new Error("sync_cursor_update_failed");
  await tx.insert(syncChanges).values({
    userId,
    cursor: counter.cursor,
    entity,
    recordId,
    version,
    data,
    deleted,
  });
}

app.get("/v1/me", async (c) => {
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [profile] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    return profile ?? null;
  });
  return c.json({ profile: result?.data ?? null, updatedAt: result?.updatedAt ?? null });
});

app.post("/v1/export", async (c) => {
  const user = c.get("session").user;
  const data = await exportAccountData(user.id);
  c.header("Content-Disposition", `attachment; filename=goal-health-export-${new Date().toISOString().slice(0, 10)}.json`);
  return c.json({ ...data, account: { id: user.id, email: user.email, name: user.name } });
});

app.delete("/v1/account", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = deleteAccountRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "account_deletion_confirmation_required" }, 400);
  try {
    await assertAccountDeletionReady();
  } catch {
    return c.json({ error: "account_deletion_migration_required" }, 503);
  }

  const headers = new Headers(c.req.raw.headers);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("content-type", "application/json");
  const authRequest = new Request(new URL("/api/auth/delete-user", c.req.url), {
    method: "POST",
    headers,
    body: JSON.stringify(parsed.data.password ? { password: parsed.data.password } : {}),
  });
  return auth.handler(authRequest);
});

app.put("/v1/me", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_profile" }, 400);
  const userId = c.get("session").user.id;
  const profile = parsed.data;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [saved] = await tx.insert(userProfiles).values({ userId, data: profile, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: { data: profile, updatedAt: new Date() },
      }).returning({ data: userProfiles.data, updatedAt: userProfiles.updatedAt });
    return saved;
  });
  if (!result) return c.json({ error: "profile_save_failed" }, 500);
  return c.json({ profile: result.data, updatedAt: result.updatedAt });
});

const defaultReminderPreferences = {
  browserNotificationsEnabled: false,
  rules: [
    { kind: "breakfast", enabled: false, localTime: "08:00" },
    { kind: "lunch", enabled: false, localTime: "13:00" },
    { kind: "dinner", enabled: false, localTime: "20:00" },
    { kind: "workout", enabled: false, localTime: "18:00" },
    { kind: "weigh_in", enabled: false, localTime: "07:30" },
  ],
} as const;

async function getReminderPreferences(userId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [saved] = await tx.select().from(reminderPreferencesTable)
      .where(eq(reminderPreferencesTable.userId, userId)).limit(1);
    const [profile] = await tx.select().from(userProfiles)
      .where(eq(userProfiles.userId, userId)).limit(1);
    const parsedProfile = profileSchema.safeParse(profile?.data);
    const timezone = parsedProfile.success ? parsedProfile.data.timezone : "UTC";
    const savedPreferences = reminderPreferencesRequestSchema.safeParse(saved?.data);
    const preferences = savedPreferences.success ? savedPreferences.data : defaultReminderPreferences;
    return reminderPreferencesResponseSchema.parse({ ...preferences, timezone });
  });
}

app.get("/v1/reminders", async (c) => {
  const userId = c.get("session").user.id;
  return c.json(await getReminderPreferences(userId));
});

app.put("/v1/reminders", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = reminderPreferencesRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_reminder_preferences" }, 400);
  const userId = c.get("session").user.id;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    await tx.insert(reminderPreferencesTable).values({ userId, data: parsed.data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: reminderPreferencesTable.userId,
        set: { data: parsed.data, updatedAt: new Date() },
      });
  });
  return c.json(await getReminderPreferences(userId));
});

app.get("/v1/connections/google", async (c) => {
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [connection] = await tx.select().from(googleCalendarConnections)
      .where(eq(googleCalendarConnections.userId, userId)).limit(1);
    const links = connection ? await tx.select({ occurrenceKey: calendarEventLinks.occurrenceKey })
      .from(calendarEventLinks).where(eq(calendarEventLinks.userId, userId)) : [];
    return { connection, linkCount: links.length };
  });
  return c.json({
    configured: googleCalendarConfigured(),
    connected: Boolean(result.connection),
    calendarName: result.connection?.calendarName ?? null,
    lastSyncedAt: result.connection?.lastSyncedAt?.toISOString() ?? null,
    linkedEvents: result.linkCount,
  });
});

app.get("/v1/connections/google/start", async (c) => {
  if (!googleCalendarConfigured()) return calendarRedirect(c, "not_configured");
  const userId = c.get("session").user.id;
  const state = makeOAuthState();
  const stateHash = hashOAuthState(state);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    await tx.delete(googleOauthStates).where(and(
      eq(googleOauthStates.userId, userId),
      lt(googleOauthStates.expiresAt, new Date()),
    ));
    await tx.insert(googleOauthStates).values({
      stateHash,
      userId,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  });
  try {
    return c.redirect(createGoogleAuthorizationUrl(state), 302);
  } catch {
    return calendarRedirect(c, "not_configured");
  }
});

app.get("/v1/connections/google/callback", async (c) => {
  if (c.req.query("error")) return calendarRedirect(c, "authorization_cancelled");
  const code = c.req.query("code") ?? "";
  const state = c.req.query("state") ?? "";
  if (code.length < 1 || code.length > 4096 || state.length < 20 || state.length > 256) {
    return calendarRedirect(c, "authorization_failed");
  }

  const userId = c.get("session").user.id;
  const stateResult = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [pending] = await tx.select().from(googleOauthStates).where(and(
      eq(googleOauthStates.userId, userId),
      eq(googleOauthStates.stateHash, hashOAuthState(state)),
      isNull(googleOauthStates.consumedAt),
      sql`${googleOauthStates.expiresAt} > now()`,
    )).for("update").limit(1);
    if (!pending) return null;
    await tx.update(googleOauthStates).set({ consumedAt: new Date() }).where(eq(googleOauthStates.stateHash, pending.stateHash));
    const [connection] = await tx.select().from(googleCalendarConnections)
      .where(eq(googleCalendarConnections.userId, userId)).limit(1);
    const [profile] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    return { connection, timezone: profileSchema.safeParse(profile?.data).success
      ? profileSchema.parse(profile?.data).timezone : "UTC" };
  });
  if (!stateResult) return calendarRedirect(c, "authorization_failed");

  try {
    const token = await exchangeGoogleCode(code);
    const encryptedRefreshToken = token.refreshToken
      ? encryptGoogleRefreshToken(token.refreshToken)
      : stateResult.connection?.encryptedRefreshToken;
    if (!encryptedRefreshToken) return calendarRedirect(c, "refresh_token_missing");
    const calendar = stateResult.connection
      ? { id: stateResult.connection.calendarId, summary: stateResult.connection.calendarName }
      : await createGoalHealthCalendar(token.accessToken, stateResult.timezone);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      await tx.insert(googleCalendarConnections).values({
        userId,
        encryptedRefreshToken,
        calendarId: calendar.id,
        calendarName: calendar.summary,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: googleCalendarConnections.userId,
        set: {
          encryptedRefreshToken,
          calendarId: calendar.id,
          calendarName: calendar.summary,
          updatedAt: new Date(),
        },
      });
    });
    return calendarRedirect(c, "connected");
  } catch (error) {
    if (error instanceof GoogleCalendarError && error.code === "google_calendar_not_configured") {
      return calendarRedirect(c, "not_configured");
    }
    return calendarRedirect(c, "authorization_failed");
  }
});

app.post("/v1/connections/google/disconnect", async (c) => {
  const userId = c.get("session").user.id;
  const [connection] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return tx.select().from(googleCalendarConnections)
      .where(eq(googleCalendarConnections.userId, userId)).limit(1);
  });
  let remoteRevoked = false;
  if (connection) {
    try {
      remoteRevoked = await revokeGoogleRefreshToken(decryptGoogleRefreshToken(connection.encryptedRefreshToken));
    } catch {
      remoteRevoked = false;
    }
  }
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    await tx.delete(calendarEventLinks).where(eq(calendarEventLinks.userId, userId));
    await tx.delete(googleOauthStates).where(eq(googleOauthStates.userId, userId));
    await tx.delete(googleCalendarConnections).where(eq(googleCalendarConnections.userId, userId));
  });
  return c.json({ disconnected: true, remoteRevoked });
});

app.post("/v1/connections/google/sync", async (c) => {
  const userId = c.get("session").user.id;
  try {
    return c.json(await syncApprovedWorkoutCalendar(userId));
  } catch (error) {
    const code = error instanceof GoogleCalendarError ? error.code : "google_calendar_sync_failed";
    const status = code === "google_calendar_not_connected" ? 409
      : code === "google_calendar_not_configured" ? 503
        : code === "active_workout_plan_invalid" ? 409 : 502;
    return c.json({ error: code }, status);
  }
});

function calendarRedirect(c: Context<BackendEnv>, status: string): Response {
  const url = new URL("/", env.AUTH_BASE_URL);
  url.searchParams.set("calendar", status);
  url.hash = "settings";
  return c.redirect(url.toString(), 303);
}

app.get("/v1/foods", async (c) => {
  const params = new URL(c.req.url).searchParams;
  const query = params.get("query")?.trim() ?? "";
  const view = params.get("view") ?? "all";
  const purpose = params.get("purpose") ?? "logging";
  const selectedMealDate = params.get("date");
  if (view !== "all" && view !== "favorites" && view !== "recent") {
    return c.json({ error: "invalid_food_search_view" }, 400);
  }
  if (purpose !== "logging" && purpose !== "meal_plan") return c.json({ error: "invalid_food_search_purpose" }, 400);
  const mealPlanPurpose = purpose === "meal_plan";
  if (mealPlanPurpose && selectedMealDate !== null && !isLocalDate(selectedMealDate)) {
    return c.json({ error: "invalid_meal_plan_date" }, 400);
  }
  const favoritesOnly = view === "favorites";
  const recentOnly = view === "recent";
  if (query.length > 80) return c.json({ error: "search_query_too_long" }, 400);
  const userId = c.get("session").user.id;
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    let safetyRequirements: FoodSafetyRequirements | null = null;
    if (mealPlanPurpose) {
      const [profileRow] = await tx.select({ data: userProfiles.data }).from(userProfiles)
        .where(eq(userProfiles.userId, userId)).limit(1);
      const profile = profileSchema.safeParse(profileRow?.data);
      if (profile.success) {
        safetyRequirements = deriveMealPlanFoodSafetyRequirements(
          profile.data.dietaryPreferences,
          profile.data.restrictions,
          profile.data.foodPreferences,
          selectedMealDate ?? undefined,
        );
      }
    }
    const favorites = await tx.select({ foodId: foodFavorites.foodId, foodSource: foodFavorites.foodSource })
      .from(foodFavorites).where(eq(foodFavorites.userId, userId));
    const favoriteSharedIds = favorites.filter((item) => item.foodSource === "shared_catalog").map((item) => item.foodId);
    const favoritePersonalIds = favorites.filter((item) => item.foodSource === "personal").map((item) => item.foodId);
    const recentKeys: string[] = [];
    if (recentOnly) {
      const recentLogs = await tx.select({ data: userRecords.data }).from(userRecords).where(and(
        eq(userRecords.userId, userId),
        eq(userRecords.entity, "food_log"),
        eq(userRecords.deleted, false),
      )).orderBy(desc(userRecords.serverUpdatedAt)).limit(200);
      const seen = new Set<string>();
      for (const row of recentLogs) {
        const parsed = foodLogRecordSchema.safeParse(row.data);
        if (!parsed.success) continue;
        const foodSource = parsed.data.foodEstimate?.savedToMyFoods ? "personal" : parsed.data.foodSource;
        const key = `${foodSource}:${parsed.data.foodId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        recentKeys.push(key);
      }
    }
    const recentSharedIds = recentKeys.filter((key) => key.startsWith("shared_catalog:")).map((key) => key.slice("shared_catalog:".length));
    const recentPersonalIds = recentKeys.filter((key) => key.startsWith("personal:")).map((key) => key.slice("personal:".length));
    const sharedIds = favoritesOnly ? favoriteSharedIds : recentOnly ? recentSharedIds : [];
    const personalIds = favoritesOnly ? favoritePersonalIds : recentOnly ? recentPersonalIds : [];
    const shared = favoritesOnly || recentOnly
      ? sharedIds.length ? await tx.select().from(catalogFoods).where(and(
        inArray(catalogFoods.id, sharedIds),
        eq(catalogFoods.active, true),
        or(ilike(catalogFoods.name, pattern), sql`array_to_string(${catalogFoods.aliases}, ' ') ILIKE ${pattern}`),
      )).orderBy(desc(catalogFoods.reviewed), asc(catalogFoods.name)).limit(100) : []
      : await tx.select().from(catalogFoods).where(and(
        eq(catalogFoods.active, true),
        or(ilike(catalogFoods.name, pattern), sql`array_to_string(${catalogFoods.aliases}, ' ') ILIKE ${pattern}`),
      )).orderBy(desc(catalogFoods.reviewed), asc(catalogFoods.name)).limit(mealPlanPurpose ? 200 : 30);
    const personal = favoritesOnly || recentOnly
      ? personalIds.length ? await tx.select().from(userFoods).where(and(
        inArray(userFoods.id, personalIds),
        eq(userFoods.userId, userId),
        or(ilike(userFoods.name, pattern), sql`array_to_string(${userFoods.aliases}, ' ') ILIKE ${pattern}`),
      )).orderBy(asc(userFoods.name)).limit(100) : []
      : await tx.select().from(userFoods).where(or(
        ilike(userFoods.name, pattern), sql`array_to_string(${userFoods.aliases}, ' ') ILIKE ${pattern}`,
      ))
        .orderBy(asc(userFoods.name)).limit(20);
    const safetyReviews = mealPlanPurpose && shared.length ? await tx.select({
      foodId: catalogFoodSafetyReviews.foodId,
      dietaryTags: catalogFoodSafetyReviews.dietaryTags,
      containsAllergens: catalogFoodSafetyReviews.containsAllergens,
      mayContainAllergens: catalogFoodSafetyReviews.mayContainAllergens,
    }).from(catalogFoodSafetyReviews).where(inArray(catalogFoodSafetyReviews.foodId, shared.map((food) => food.id))) : [];
    return { shared, personal, favorites, recentKeys, safetyRequirements, safetyReviews };
  });
  const favoriteKeys = new Set(result.favorites.map((item) => `${item.foodSource}:${item.foodId}`));
  const safetyReviewByFoodId = new Map(result.safetyReviews.map((review) => [review.foodId, review]));
  const hasSafetyFilters = result.safetyRequirements
    ? result.safetyRequirements.dietaryTags.length > 0 || result.safetyRequirements.avoidAllergens.length > 0
    : false;
  const sharedFoods = result.shared.filter((food) => {
    if (!mealPlanPurpose) return true;
    const requirements = result.safetyRequirements;
    if (!food.reviewed || !requirements || requirements.unsupportedRestrictions.length > 0) return false;
    const review = safetyReviewByFoodId.get(food.id);
    const metadata: FoodSafetyMetadata | null = review ? {
      dietaryTags: review.dietaryTags as FoodSafetyMetadata["dietaryTags"],
      containsAllergens: review.containsAllergens as FoodSafetyMetadata["containsAllergens"],
      mayContainAllergens: review.mayContainAllergens as FoodSafetyMetadata["mayContainAllergens"],
    } : null;
    return isFoodAllowedByReviewedMetadata(metadata, requirements);
  });
  const safetyFilterUnavailable = mealPlanPurpose && (!result.safetyRequirements || result.safetyRequirements.unsupportedRestrictions.length > 0);
  const personalFoods = mealPlanPurpose && (hasSafetyFilters || safetyFilterUnavailable) ? [] : result.personal;
  const foods = [
    ...sharedFoods.map((food) => ({
      id: food.id,
      name: food.name,
      aliases: food.aliases,
      category: food.category,
      source: "shared_catalog" as const,
      isFavorite: favoriteKeys.has(`shared_catalog:${food.id}`),
      sourceNote: food.source,
      reviewed: food.reviewed,
      caloriesKcalPer100g: nutritionValue(food.caloriesKcalPer100g),
      proteinGPer100g: nutritionValue(food.proteinGPer100g),
      carbohydrateGPer100g: nutritionValue(food.carbohydrateGPer100g),
      fatGPer100g: nutritionValue(food.fatGPer100g),
    })),
    ...personalFoods.map((food) => ({
      id: food.id,
      name: food.name,
      aliases: food.aliases,
      category: food.category,
      source: "personal" as const,
      isFavorite: favoriteKeys.has(`personal:${food.id}`),
      sourceNote: food.sourceNote,
      isEstimate: food.sourceNote.startsWith(SAVED_AI_FOOD_PREFIX),
      reviewed: false,
      recipe: food.recipe,
      recipeVersion: food.recipeVersion,
      caloriesKcalPer100g: nutritionValue(food.caloriesKcalPer100g),
      proteinGPer100g: nutritionValue(food.proteinGPer100g),
      carbohydrateGPer100g: nutritionValue(food.carbohydrateGPer100g),
      fatGPer100g: nutritionValue(food.fatGPer100g),
    })),
  ];
  if (recentOnly) {
    const recentOrder = new Map(result.recentKeys.map((key, index) => [key, index]));
    foods.sort((left, right) => (recentOrder.get(`${left.source}:${left.id}`) ?? Number.MAX_SAFE_INTEGER)
      - (recentOrder.get(`${right.source}:${right.id}`) ?? Number.MAX_SAFE_INTEGER));
  }
  return c.json({ foods });
});

app.put("/v1/foods/:foodId/favorite", async (c) => {
  const foodId = c.req.param("foodId");
  if (!isUuid(foodId)) return c.json({ error: "invalid_food_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = setFoodFavoriteRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_food_favorite" }, 400);
  const userId = c.get("session").user.id;
  const saved = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    if (parsed.data.favorite) {
      const [food] = parsed.data.foodSource === "shared_catalog"
        ? await tx.select({ id: catalogFoods.id }).from(catalogFoods).where(and(
          eq(catalogFoods.id, foodId), eq(catalogFoods.active, true),
        )).limit(1)
        : await tx.select({ id: userFoods.id }).from(userFoods).where(and(
          eq(userFoods.id, foodId), eq(userFoods.userId, userId),
        )).limit(1);
      if (!food) return false;
      await tx.insert(foodFavorites).values({ userId, foodSource: parsed.data.foodSource, foodId })
        .onConflictDoNothing();
    } else {
      await tx.delete(foodFavorites).where(and(
        eq(foodFavorites.userId, userId),
        eq(foodFavorites.foodSource, parsed.data.foodSource),
        eq(foodFavorites.foodId, foodId),
      ));
    }
    return true;
  });
  if (!saved) return c.json({ error: "food_not_found" }, 404);
  return c.json({ foodId, foodSource: parsed.data.foodSource, favorite: parsed.data.favorite });
});

app.get("/v1/foods/:foodId/portions", async (c) => {
  const foodId = c.req.param("foodId");
  const foodSource = c.req.query("source");
  if (!isUuid(foodId)) return c.json({ error: "invalid_food_id" }, 400);
  if (foodSource !== "shared_catalog" && foodSource !== "personal") {
    return c.json({ error: "invalid_food_source" }, 400);
  }
  const userId = c.get("session").user.id;
  const portions = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const saved = await tx.select({ id: foodPortions.id, label: foodPortions.label, grams: foodPortions.grams })
      .from(foodPortions).where(and(
        eq(foodPortions.userId, userId),
        eq(foodPortions.foodSource, foodSource),
        eq(foodPortions.foodId, foodId),
      )).orderBy(asc(foodPortions.label));
    if (foodSource !== "shared_catalog") return saved.map((portion) => ({ ...portion, isDefault: false }));
    const defaults = await tx.select({ id: catalogFoodPortions.id, label: catalogFoodPortions.label, grams: catalogFoodPortions.grams })
      .from(catalogFoodPortions).where(eq(catalogFoodPortions.foodId, foodId)).orderBy(asc(catalogFoodPortions.label));
    return [...defaults.map((portion) => ({ ...portion, isDefault: true })), ...saved.map((portion) => ({ ...portion, isDefault: false }))]
      .sort((left, right) => left.label.localeCompare(right.label));
  });
  return c.json({ portions });
});

app.post("/v1/foods/:foodId/portions", async (c) => {
  const foodId = c.req.param("foodId");
  if (!isUuid(foodId)) return c.json({ error: "invalid_food_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = createFoodPortionRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_food_portion" }, 400);
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [food] = parsed.data.foodSource === "shared_catalog"
      ? await tx.select({ id: catalogFoods.id }).from(catalogFoods).where(and(
        eq(catalogFoods.id, foodId), eq(catalogFoods.active, true),
      )).limit(1)
      : await tx.select({ id: userFoods.id }).from(userFoods).where(and(
        eq(userFoods.id, foodId), eq(userFoods.userId, userId),
      )).limit(1);
    if (!food) return { status: "food_not_found" as const };
    const existing = await tx.select({ id: foodPortions.id }).from(foodPortions).where(and(
      eq(foodPortions.userId, userId),
      eq(foodPortions.foodSource, parsed.data.foodSource),
      eq(foodPortions.foodId, foodId),
    )).limit(20);
    if (existing.length >= 20) return { status: "portion_limit" as const };
    const [portion] = await tx.insert(foodPortions).values({
      userId,
      foodSource: parsed.data.foodSource,
      foodId,
      label: parsed.data.label,
      grams: parsed.data.grams,
    }).onConflictDoNothing().returning({ id: foodPortions.id, label: foodPortions.label, grams: foodPortions.grams });
    return portion ? { status: "saved" as const, portion } : { status: "duplicate" as const };
  });
  if (result.status === "food_not_found") return c.json({ error: "food_not_found" }, 404);
  if (result.status === "portion_limit") return c.json({ error: "food_portion_limit_reached" }, 409);
  if (result.status === "duplicate") return c.json({ error: "food_portion_label_exists" }, 409);
  return c.json({ portion: { ...result.portion, isDefault: false } }, 201);
});

app.delete("/v1/foods/:foodId/portions/:portionId", async (c) => {
  const foodId = c.req.param("foodId");
  const portionId = c.req.param("portionId");
  if (!isUuid(foodId) || !isUuid(portionId)) return c.json({ error: "invalid_food_portion_id" }, 400);
  const userId = c.get("session").user.id;
  const deleted = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return await tx.delete(foodPortions).where(and(
      eq(foodPortions.id, portionId),
      eq(foodPortions.userId, userId),
      eq(foodPortions.foodId, foodId),
    )).returning({ id: foodPortions.id });
  });
  if (!deleted.length) return c.json({ error: "food_portion_not_found" }, 404);
  return c.body(null, 204);
});

app.post("/v1/foods/recognize-photo", bodyLimit({
  maxSize: 3_400_000,
  onError: (c) => c.json({ error: "payload_too_large" }, 413),
}), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = foodPhotoRecognitionRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_food_photo" }, 400);
  try { return c.json(await createFoodEstimate(c.get("session").user.id, parsed.data)); }
  catch (error) {
    if (error instanceof FoodVisionError) return c.json({ error: error.code }, error.status);
    return c.json({ error: "ai_provider_unavailable" }, 503);
  }
});

app.post("/v1/foods/estimate-text", bodyLimit({
  maxSize: 20000,
  onError: (c) => c.json({ error: "payload_too_large" }, 413),
}), async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_request" }, 400); }
  const parsed = foodTextEstimateRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_food_estimate_request" }, 400);
  try { return c.json(await createFoodEstimate(c.get("session").user.id, parsed.data)); }
  catch (error) {
    if (error instanceof FoodVisionError) return c.json({ error: error.code }, error.status);
    return c.json({ error: "ai_provider_unavailable" }, 503);
  }
});

app.post("/v1/food-logs/photo", bodyLimit({
  maxSize: 60000,
  onError: (c) => c.json({ error: "payload_too_large" }, 413),
}), async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_request" }, 400); }
  const parsed = confirmFoodPhotoRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_photo_food_log" }, 400);
  const userId = c.get("session").user.id;
  const draft = readFoodPhotoDraft(parsed.data.draftToken, userId);
  if (!draft) return c.json({ error: "photo_draft_unavailable" }, 409);
  if (parsed.data.items.some((item) => !draft.estimate.items[item.index])) return c.json({ error: "invalid_photo_item" }, 400);
  const records = buildPhotoFoodRecords(draft, parsed.data);
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"photo-log:" + userId + ":" + parsed.data.requestId}, 0))`);
    const existing = await tx.select({ id: userRecords.recordId, data: userRecords.data, deleted: userRecords.deleted }).from(userRecords).where(and(
      eq(userRecords.userId, userId), eq(userRecords.entity, "food_log"),
      sql`COALESCE(${userRecords.data}->'foodEstimate'->>'requestId', ${userRecords.data}->'photoEstimate'->>'requestId') = ${parsed.data.requestId}`,
      sql`${userRecords.data}->>'foodId' = ${userRecords.recordId}::text`,
    ));
    if (existing.length) {
      const same = existing.length === records.length && records.every((record) => {
        const found = existing.find((row) => row.id === record.id);
        const prior = foodLogRecordSchema.safeParse(found?.data);
        return found && !found.deleted && prior.success && JSON.stringify(prior.data) === JSON.stringify(record.data);
      });
      return { status: same ? "saved" as const : "conflict" as const, idempotent: same };
    }
    const [run] = await tx.select({ id: aiRuns.id, inputSnapshot: aiRuns.inputSnapshot }).from(aiRuns).where(and(
      eq(aiRuns.userId, userId), eq(aiRuns.id, draft.runId), eq(aiRuns.kind, "food_vision"), eq(aiRuns.status, "completed"),
    )).limit(1);
    if (!run || (run.inputSnapshot.inputType ?? "photo") !== draft.inputType) return { status: "draft_missing" as const, idempotent: false };
    for (const record of records) {
      await tx.insert(userFoods).values({
        id: record.data.foodId, userId, name: record.data.foodName, category: "prepared_meal",
        aliases: draft.inputType === "text" && draft.foodName && draft.estimate.items.length === 1
          && draft.foodName.toLocaleLowerCase() !== record.data.foodName.toLocaleLowerCase() ? [draft.foodName] : [],
        caloriesKcalPer100g: record.data.nutritionPer100g.caloriesKcal.toFixed(2),
        proteinGPer100g: record.data.nutritionPer100g.proteinG.toFixed(2),
        carbohydrateGPer100g: record.data.nutritionPer100g.carbohydrateG.toFixed(2),
        fatGPer100g: record.data.nutritionPer100g.fatG.toFixed(2),
        sourceNote: `${SAVED_AI_FOOD_PREFIX} ${draft.inputType}; ${draft.model}. Confirm recipe and portion before reuse.`,
      });
      await tx.insert(userRecords).values({ userId, entity: "food_log", recordId: record.id, version: 1, data: record.data, deleted: false, serverUpdatedAt: new Date() });
      await appendSyncChange(tx, userId, "food_log", record.id, record.data);
    }
    return { status: "saved" as const, idempotent: false };
  });
  if (result.status === "conflict") return c.json({ error: "food_log_id_conflict" }, 409);
  if (result.status === "draft_missing") return c.json({ error: "photo_draft_unavailable" }, 409);
  return c.json({ count: records.length, idempotent: result.idempotent }, result.idempotent ? 200 : 201);
});

app.post("/v1/foods/custom", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = createCustomFoodRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_custom_food" }, 400);
  const userId = c.get("session").user.id;
  const food = parsed.data;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [existing] = await tx.select().from(userFoods).where(and(
      eq(userFoods.userId, userId),
      eq(userFoods.id, food.foodId),
    )).limit(1);
    if (existing) {
      const same = existing.name === food.name
        && JSON.stringify(existing.aliases) === JSON.stringify(food.aliases)
        && existing.category === food.category
        && nutritionValue(existing.caloriesKcalPer100g) === food.caloriesKcalPer100g
        && nutritionValue(existing.proteinGPer100g) === food.proteinGPer100g
        && nutritionValue(existing.carbohydrateGPer100g) === food.carbohydrateGPer100g
        && nutritionValue(existing.fatGPer100g) === food.fatGPer100g;
      return { status: same ? "saved" as const : "conflict" as const, food: existing, idempotent: same };
    }
    const [saved] = await tx.insert(userFoods).values({
      id: food.foodId,
      userId,
      name: food.name,
      aliases: food.aliases,
      category: food.category,
      caloriesKcalPer100g: String(food.caloriesKcalPer100g),
      proteinGPer100g: String(food.proteinGPer100g),
      carbohydrateGPer100g: String(food.carbohydrateGPer100g),
      fatGPer100g: String(food.fatGPer100g),
      sourceNote: food.sourceNote,
      updatedAt: new Date(),
    }).returning();
    if (!saved) throw new Error("custom_food_save_failed");
    return { status: "saved" as const, food: saved, idempotent: false };
  });
  if (result.status === "conflict") return c.json({ error: "food_id_conflict" }, 409);
  return c.json({
    food: {
      id: result.food.id,
      name: result.food.name,
      aliases: result.food.aliases,
      category: result.food.category,
      source: "personal",
      isFavorite: false,
      sourceNote: result.food.sourceNote,
      reviewed: false,
      recipe: result.food.recipe,
      recipeVersion: result.food.recipeVersion,
      caloriesKcalPer100g: nutritionValue(result.food.caloriesKcalPer100g),
      proteinGPer100g: nutritionValue(result.food.proteinGPer100g),
      carbohydrateGPer100g: nutritionValue(result.food.carbohydrateGPer100g),
      fatGPer100g: nutritionValue(result.food.fatGPer100g),
    },
    idempotent: result.idempotent,
  }, result.idempotent ? 200 : 201);
});

app.post("/v1/foods/recipes", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = createFoodRecipeRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_food_recipe" }, 400);
  const userId = c.get("session").user.id;
  const recipeRequest = parsed.data;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const sharedIds = [...new Set(recipeRequest.ingredients.filter((item) => item.foodSource === "shared_catalog").map((item) => item.foodId))];
    const personalIds = [...new Set(recipeRequest.ingredients.filter((item) => item.foodSource === "personal").map((item) => item.foodId))];
    const [sharedFoods, personalFoods] = await Promise.all([
      sharedIds.length ? tx.select().from(catalogFoods).where(and(inArray(catalogFoods.id, sharedIds), eq(catalogFoods.active, true))) : Promise.resolve([]),
      personalIds.length ? tx.select().from(userFoods).where(and(inArray(userFoods.id, personalIds), eq(userFoods.userId, userId))) : Promise.resolve([]),
    ]);
    const availableFoods = new Map<string, {
      id: string;
      name: string;
      category: string;
      foodSource: "shared_catalog" | "personal";
      nutritionPer100g: { caloriesKcal: number; proteinG: number; carbohydrateG: number; fatG: number };
    }>();
    for (const food of sharedFoods) {
      availableFoods.set(`shared_catalog:${food.id}`, {
        id: food.id,
        name: food.name,
        category: food.category,
        foodSource: "shared_catalog",
        nutritionPer100g: {
          caloriesKcal: nutritionValue(food.caloriesKcalPer100g),
          proteinG: nutritionValue(food.proteinGPer100g),
          carbohydrateG: nutritionValue(food.carbohydrateGPer100g),
          fatG: nutritionValue(food.fatGPer100g),
        },
      });
    }
    for (const food of personalFoods) {
      availableFoods.set(`personal:${food.id}`, {
        id: food.id,
        name: food.name,
        category: food.category,
        foodSource: "personal",
        nutritionPer100g: {
          caloriesKcal: nutritionValue(food.caloriesKcalPer100g),
          proteinG: nutritionValue(food.proteinGPer100g),
          carbohydrateG: nutritionValue(food.carbohydrateGPer100g),
          fatG: nutritionValue(food.fatGPer100g),
        },
      });
    }
    const ingredients = recipeRequest.ingredients.map((item) => {
      const food = availableFoods.get(`${item.foodSource}:${item.foodId}`);
      return food ? {
        foodId: food.id,
        foodSource: food.foodSource,
        foodName: food.name,
        quantityGrams: item.quantityGrams,
        nutritionPer100g: food.nutritionPer100g,
      } : null;
    });
    if (ingredients.some((ingredient) => ingredient === null)) return { status: "ingredient_missing" as const };
    const recipeSnapshot = {
      yieldGrams: recipeRequest.yieldGrams,
      instructions: recipeRequest.instructions,
      ingredients: ingredients.filter((ingredient): ingredient is NonNullable<typeof ingredient> => ingredient !== null),
    };
    if (recipeSnapshot.yieldGrams > recipeSnapshot.ingredients.reduce((sum, ingredient) => sum + ingredient.quantityGrams, 0)) {
      return { status: "yield_exceeds_ingredients" as const };
    }
    const totals = recipeSnapshot.ingredients.reduce((sum, ingredient) => ({
      caloriesKcal: sum.caloriesKcal + ingredient.nutritionPer100g.caloriesKcal * ingredient.quantityGrams / 100,
      proteinG: sum.proteinG + ingredient.nutritionPer100g.proteinG * ingredient.quantityGrams / 100,
      carbohydrateG: sum.carbohydrateG + ingredient.nutritionPer100g.carbohydrateG * ingredient.quantityGrams / 100,
      fatG: sum.fatG + ingredient.nutritionPer100g.fatG * ingredient.quantityGrams / 100,
    }), { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 });
    const nutritionPer100g = {
      caloriesKcal: roundNutrition(totals.caloriesKcal * 100 / recipeSnapshot.yieldGrams),
      proteinG: roundNutrition(totals.proteinG * 100 / recipeSnapshot.yieldGrams),
      carbohydrateG: roundNutrition(totals.carbohydrateG * 100 / recipeSnapshot.yieldGrams),
      fatG: roundNutrition(totals.fatG * 100 / recipeSnapshot.yieldGrams),
    };
    if (nutritionPer100g.caloriesKcal > 1000 || [nutritionPer100g.proteinG, nutritionPer100g.carbohydrateG, nutritionPer100g.fatG].some((value) => value > 100)) {
      return { status: "nutrition_out_of_bounds" as const };
    }
    const sourceNote = `Recipe calculated from ${recipeSnapshot.ingredients.length} ingredient entries; finished yield ${recipeSnapshot.yieldGrams} g.`;
    const [existing] = await tx.select().from(userFoods).where(and(
      eq(userFoods.userId, userId),
      eq(userFoods.id, recipeRequest.recipeId),
    )).limit(1);
    if (existing) {
      const same = existing.name === recipeRequest.name
        && JSON.stringify(existing.aliases) === JSON.stringify(recipeRequest.aliases)
        && existing.category === "prepared_meal"
        && sameRecipeComposition(existing.recipe, recipeSnapshot)
        && nutritionValue(existing.caloriesKcalPer100g) === nutritionPer100g.caloriesKcal
        && nutritionValue(existing.proteinGPer100g) === nutritionPer100g.proteinG
        && nutritionValue(existing.carbohydrateGPer100g) === nutritionPer100g.carbohydrateG
        && nutritionValue(existing.fatGPer100g) === nutritionPer100g.fatG;
      return { status: same ? "saved" as const : "conflict" as const, food: existing, idempotent: same };
    }
    const [saved] = await tx.insert(userFoods).values({
      id: recipeRequest.recipeId,
      userId,
      name: recipeRequest.name,
      aliases: recipeRequest.aliases,
      category: "prepared_meal",
      caloriesKcalPer100g: String(nutritionPer100g.caloriesKcal),
      proteinGPer100g: String(nutritionPer100g.proteinG),
      carbohydrateGPer100g: String(nutritionPer100g.carbohydrateG),
      fatGPer100g: String(nutritionPer100g.fatG),
      sourceNote,
      recipe: recipeSnapshot,
      recipeVersion: 1,
      updatedAt: new Date(),
    }).returning();
    if (!saved) throw new Error("food_recipe_save_failed");
    await tx.insert(userFoodRecipeVersions).values({
      userId,
      foodId: saved.id,
      version: 1,
      snapshot: {
        name: saved.name,
        aliases: saved.aliases,
        category: saved.category,
        caloriesKcalPer100g: nutritionPer100g.caloriesKcal,
        proteinGPer100g: nutritionPer100g.proteinG,
        carbohydrateGPer100g: nutritionPer100g.carbohydrateG,
        fatGPer100g: nutritionPer100g.fatG,
        sourceNote: saved.sourceNote,
        recipe: recipeSnapshot,
      },
    });
    return { status: "saved" as const, food: saved, idempotent: false };
  });
  if (result.status === "ingredient_missing") return c.json({ error: "food_recipe_ingredient_not_found" }, 404);
  if (result.status === "yield_exceeds_ingredients") return c.json({ error: "food_recipe_yield_exceeds_ingredients" }, 400);
  if (result.status === "nutrition_out_of_bounds") return c.json({ error: "food_recipe_nutrition_out_of_bounds" }, 400);
  if (result.status === "conflict") return c.json({ error: "food_recipe_id_conflict" }, 409);
  return c.json({
    food: {
      id: result.food.id,
      name: result.food.name,
      aliases: result.food.aliases,
      category: result.food.category,
      source: "personal",
      isFavorite: false,
      sourceNote: result.food.sourceNote,
      reviewed: false,
      recipe: result.food.recipe,
      recipeVersion: result.food.recipeVersion,
      caloriesKcalPer100g: nutritionValue(result.food.caloriesKcalPer100g),
      proteinGPer100g: nutritionValue(result.food.proteinGPer100g),
      carbohydrateGPer100g: nutritionValue(result.food.carbohydrateGPer100g),
      fatGPer100g: nutritionValue(result.food.fatGPer100g),
    },
    idempotent: result.idempotent,
  }, result.idempotent ? 200 : 201);
});

app.put("/v1/foods/recipes/:id", async (c) => {
  const foodId = c.req.param("id");
  if (!isUuid(foodId)) return c.json({ error: "invalid_food_recipe_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = updateFoodRecipeRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_food_recipe" }, 400);
  const userId = c.get("session").user.id;
  const request = parsed.data;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [existing] = await tx.select().from(userFoods).where(and(
      eq(userFoods.userId, userId),
      eq(userFoods.id, foodId),
    )).limit(1);
    if (!existing?.recipe || existing.recipeVersion === null) return { status: "missing" as const };
    const sameRequest = existing.name === request.name
      && JSON.stringify(existing.aliases) === JSON.stringify(request.aliases)
      && existing.recipe.yieldGrams === request.yieldGrams
      && JSON.stringify(existing.recipe.instructions ?? []) === JSON.stringify(request.instructions)
      && existing.recipe.ingredients.length === request.ingredients.length
      && existing.recipe.ingredients.every((ingredient, index) => {
        const requestedIngredient = request.ingredients[index];
        return requestedIngredient !== undefined
          && ingredient.foodId === requestedIngredient.foodId
          && ingredient.foodSource === requestedIngredient.foodSource
          && ingredient.quantityGrams === requestedIngredient.quantityGrams;
      });
    if (existing.recipeVersion !== request.baseVersion) {
      return sameRequest
        ? { status: "saved" as const, food: existing, idempotent: true }
        : { status: "conflict" as const, currentVersion: existing.recipeVersion };
    }
    if (request.ingredients.some((item) => item.foodSource === "personal" && item.foodId === foodId)) {
      return { status: "self_reference" as const };
    }

    const sharedIds = [...new Set(request.ingredients.filter((item) => item.foodSource === "shared_catalog").map((item) => item.foodId))];
    const personalIds = [...new Set(request.ingredients.filter((item) => item.foodSource === "personal").map((item) => item.foodId))];
    const [sharedFoods, personalFoods] = await Promise.all([
      sharedIds.length ? tx.select().from(catalogFoods).where(and(inArray(catalogFoods.id, sharedIds), eq(catalogFoods.active, true))) : Promise.resolve([]),
      personalIds.length ? tx.select().from(userFoods).where(and(inArray(userFoods.id, personalIds), eq(userFoods.userId, userId))) : Promise.resolve([]),
    ]);
    const availableFoods = new Map<string, {
      id: string;
      name: string;
      category: string;
      foodSource: "shared_catalog" | "personal";
      nutritionPer100g: { caloriesKcal: number; proteinG: number; carbohydrateG: number; fatG: number };
    }>();
    for (const food of sharedFoods) availableFoods.set(`shared_catalog:${food.id}`, {
      id: food.id,
      name: food.name,
      category: food.category,
      foodSource: "shared_catalog",
      nutritionPer100g: {
        caloriesKcal: nutritionValue(food.caloriesKcalPer100g),
        proteinG: nutritionValue(food.proteinGPer100g),
        carbohydrateG: nutritionValue(food.carbohydrateGPer100g),
        fatG: nutritionValue(food.fatGPer100g),
      },
    });
    for (const food of personalFoods) availableFoods.set(`personal:${food.id}`, {
      id: food.id,
      name: food.name,
      category: food.category,
      foodSource: "personal",
      nutritionPer100g: {
        caloriesKcal: nutritionValue(food.caloriesKcalPer100g),
        proteinG: nutritionValue(food.proteinGPer100g),
        carbohydrateG: nutritionValue(food.carbohydrateGPer100g),
        fatG: nutritionValue(food.fatGPer100g),
      },
    });
    const ingredients = request.ingredients.map((item) => {
      const food = availableFoods.get(`${item.foodSource}:${item.foodId}`);
      return food ? {
        foodId: food.id,
        foodSource: food.foodSource,
        foodName: food.name,
        quantityGrams: item.quantityGrams,
        nutritionPer100g: food.nutritionPer100g,
      } : null;
    });
    if (ingredients.some((ingredient) => ingredient === null)) return { status: "ingredient_missing" as const };
    const recipeSnapshot = {
      yieldGrams: request.yieldGrams,
      instructions: request.instructions,
      ingredients: ingredients.filter((ingredient): ingredient is NonNullable<typeof ingredient> => ingredient !== null),
    };
    if (recipeSnapshot.yieldGrams > recipeSnapshot.ingredients.reduce((sum, ingredient) => sum + ingredient.quantityGrams, 0)) {
      return { status: "yield_exceeds_ingredients" as const };
    }
    const totals = recipeSnapshot.ingredients.reduce((sum, ingredient) => ({
      caloriesKcal: sum.caloriesKcal + ingredient.nutritionPer100g.caloriesKcal * ingredient.quantityGrams / 100,
      proteinG: sum.proteinG + ingredient.nutritionPer100g.proteinG * ingredient.quantityGrams / 100,
      carbohydrateG: sum.carbohydrateG + ingredient.nutritionPer100g.carbohydrateG * ingredient.quantityGrams / 100,
      fatG: sum.fatG + ingredient.nutritionPer100g.fatG * ingredient.quantityGrams / 100,
    }), { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 });
    const nutritionPer100g = {
      caloriesKcal: roundNutrition(totals.caloriesKcal * 100 / recipeSnapshot.yieldGrams),
      proteinG: roundNutrition(totals.proteinG * 100 / recipeSnapshot.yieldGrams),
      carbohydrateG: roundNutrition(totals.carbohydrateG * 100 / recipeSnapshot.yieldGrams),
      fatG: roundNutrition(totals.fatG * 100 / recipeSnapshot.yieldGrams),
    };
    if (nutritionPer100g.caloriesKcal > 1000 || [nutritionPer100g.proteinG, nutritionPer100g.carbohydrateG, nutritionPer100g.fatG].some((value) => value > 100)) {
      return { status: "nutrition_out_of_bounds" as const };
    }
    const sourceNote = `Recipe calculated from ${recipeSnapshot.ingredients.length} ingredient entries; finished yield ${recipeSnapshot.yieldGrams} g.`;
    const same = existing.name === request.name
      && JSON.stringify(existing.aliases) === JSON.stringify(request.aliases)
      && sameRecipeComposition(existing.recipe, recipeSnapshot)
      && nutritionValue(existing.caloriesKcalPer100g) === nutritionPer100g.caloriesKcal
      && nutritionValue(existing.proteinGPer100g) === nutritionPer100g.proteinG
      && nutritionValue(existing.carbohydrateGPer100g) === nutritionPer100g.carbohydrateG
      && nutritionValue(existing.fatGPer100g) === nutritionPer100g.fatG;
    if (same) return { status: "saved" as const, food: existing, idempotent: true };

    const nextVersion = existing.recipeVersion + 1;
    const [saved] = await tx.update(userFoods).set({
      name: request.name,
      aliases: request.aliases,
      caloriesKcalPer100g: String(nutritionPer100g.caloriesKcal),
      proteinGPer100g: String(nutritionPer100g.proteinG),
      carbohydrateGPer100g: String(nutritionPer100g.carbohydrateG),
      fatGPer100g: String(nutritionPer100g.fatG),
      sourceNote,
      recipe: recipeSnapshot,
      recipeVersion: nextVersion,
      updatedAt: new Date(),
    }).where(and(
      eq(userFoods.userId, userId),
      eq(userFoods.id, foodId),
      eq(userFoods.recipeVersion, request.baseVersion),
    )).returning();
    if (!saved) return { status: "conflict" as const, currentVersion: existing.recipeVersion };
    await tx.insert(userFoodRecipeVersions).values({
      userId,
      foodId,
      version: nextVersion,
      snapshot: {
        name: saved.name,
        aliases: saved.aliases,
        category: saved.category,
        caloriesKcalPer100g: nutritionPer100g.caloriesKcal,
        proteinGPer100g: nutritionPer100g.proteinG,
        carbohydrateGPer100g: nutritionPer100g.carbohydrateG,
        fatGPer100g: nutritionPer100g.fatG,
        sourceNote: saved.sourceNote,
        recipe: recipeSnapshot,
      },
    });
    return { status: "saved" as const, food: saved, idempotent: false };
  });
  if (result.status === "missing") return c.json({ error: "food_recipe_not_found" }, 404);
  if (result.status === "conflict") return c.json({ error: "food_recipe_version_conflict", currentVersion: result.currentVersion }, 409);
  if (result.status === "self_reference") return c.json({ error: "food_recipe_cannot_include_itself" }, 400);
  if (result.status === "ingredient_missing") return c.json({ error: "food_recipe_ingredient_not_found" }, 404);
  if (result.status === "yield_exceeds_ingredients") return c.json({ error: "food_recipe_yield_exceeds_ingredients" }, 400);
  if (result.status === "nutrition_out_of_bounds") return c.json({ error: "food_recipe_nutrition_out_of_bounds" }, 400);
  return c.json({
    food: {
      id: result.food.id,
      name: result.food.name,
      aliases: result.food.aliases,
      category: result.food.category,
      source: "personal",
      isFavorite: false,
      sourceNote: result.food.sourceNote,
      reviewed: false,
      recipe: result.food.recipe,
      recipeVersion: result.food.recipeVersion,
      caloriesKcalPer100g: nutritionValue(result.food.caloriesKcalPer100g),
      proteinGPer100g: nutritionValue(result.food.proteinGPer100g),
      carbohydrateGPer100g: nutritionValue(result.food.carbohydrateGPer100g),
      fatGPer100g: nutritionValue(result.food.fatGPer100g),
    },
    idempotent: result.idempotent,
  }, 200);
});

app.get("/v1/foods/recipes/:id/versions", async (c) => {
  const foodId = c.req.param("id");
  if (!isUuid(foodId)) return c.json({ error: "invalid_food_recipe_id" }, 400);
  const userId = c.get("session").user.id;
  const versions = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [food] = await tx.select({ id: userFoods.id }).from(userFoods).where(and(
      eq(userFoods.id, foodId),
      eq(userFoods.userId, userId),
      sql`${userFoods.recipe} IS NOT NULL`,
    )).limit(1);
    if (!food) return null;
    return tx.select({
      version: userFoodRecipeVersions.version,
      snapshot: userFoodRecipeVersions.snapshot,
      createdAt: userFoodRecipeVersions.createdAt,
    }).from(userFoodRecipeVersions).where(and(
      eq(userFoodRecipeVersions.userId, userId),
      eq(userFoodRecipeVersions.foodId, foodId),
    )).orderBy(desc(userFoodRecipeVersions.version));
  });
  if (versions === null) return c.json({ error: "food_recipe_not_found" }, 404);
  return c.json({ versions: versions.map((version) => ({
    ...version,
    createdAt: version.createdAt.toISOString(),
  })) });
});

app.post("/v1/food-logs", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = createFoodLogRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_food_log" }, 400);
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [existing] = await tx.select({ data: userRecords.data, version: userRecords.version }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "food_log"),
      eq(userRecords.recordId, parsed.data.logId),
      eq(userRecords.deleted, false),
    )).limit(1);
    if (existing) {
      const prior = foodLogRecordSchema.safeParse(existing.data);
      const same = prior.success
        && prior.data.foodId === parsed.data.foodId
        && prior.data.occurredAt === parsed.data.occurredAt
        && prior.data.mealType === parsed.data.mealType
        && prior.data.quantityGrams === parsed.data.quantityGrams
        && (prior.data.portionId ?? null) === (parsed.data.portionId ?? null)
        && (prior.data.portionCount ?? 1) === (parsed.data.portionCount ?? 1);
      return { status: same ? "saved" as const : "conflict" as const, data: existing.data, version: existing.version, idempotent: same };
    }

    const [shared] = await tx.select().from(catalogFoods).where(and(
      eq(catalogFoods.id, parsed.data.foodId),
      eq(catalogFoods.active, true),
    )).limit(1);
    const [personal] = shared ? [] : await tx.select().from(userFoods).where(and(
      eq(userFoods.userId, userId),
      eq(userFoods.id, parsed.data.foodId),
    )).limit(1);
    const food = shared ?? personal;
    if (!food) return { status: "food_not_found" as const };
    let portionLabel: string | null = null;
    const portionCount = parsed.data.portionCount ?? 1;
    if (!parsed.data.portionId && parsed.data.portionCount !== undefined) return { status: "portion_invalid" as const };
    if (parsed.data.portionId) {
      const foodSource = shared ? "shared_catalog" : "personal";
      const [savedPortion] = await tx.select({ label: foodPortions.label, grams: foodPortions.grams }).from(foodPortions).where(and(
        eq(foodPortions.id, parsed.data.portionId),
        eq(foodPortions.userId, userId),
        eq(foodPortions.foodSource, foodSource),
        eq(foodPortions.foodId, parsed.data.foodId),
      )).limit(1);
      const [catalogPortion] = shared && !savedPortion ? await tx.select({ label: catalogFoodPortions.label, grams: catalogFoodPortions.grams }).from(catalogFoodPortions).where(and(
        eq(catalogFoodPortions.id, parsed.data.portionId),
        eq(catalogFoodPortions.foodId, parsed.data.foodId),
      )).limit(1) : [];
      const portion = savedPortion ?? catalogPortion;
      if (!portion || roundNutrition(Number(portion.grams) * portionCount) !== roundNutrition(parsed.data.quantityGrams)) return { status: "portion_invalid" as const };
      portionLabel = portion.label;
    }
    const nutritionPer100g = {
      caloriesKcal: nutritionValue(food.caloriesKcalPer100g),
      proteinG: nutritionValue(food.proteinGPer100g),
      carbohydrateG: nutritionValue(food.carbohydrateGPer100g),
      fatG: nutritionValue(food.fatGPer100g),
    };
    const multiplier = parsed.data.quantityGrams / 100;
    const data = foodLogRecordSchema.parse({
      foodId: food.id,
      foodSource: shared ? "shared_catalog" : "personal",
      foodName: food.name,
      ...(personal?.sourceNote.startsWith(SAVED_AI_FOOD_PREFIX) ? { nutritionProvenance: "ai_estimate" } : {}),
      category: food.category,
      occurredAt: parsed.data.occurredAt,
      mealType: parsed.data.mealType,
      quantityGrams: parsed.data.quantityGrams,
      portionId: parsed.data.portionId ?? null,
      portionLabel,
      portionCount: parsed.data.portionId ? portionCount : null,
      nutritionPer100g,
      nutritionTotal: {
        caloriesKcal: roundNutrition(nutritionPer100g.caloriesKcal * multiplier),
        proteinG: roundNutrition(nutritionPer100g.proteinG * multiplier),
        carbohydrateG: roundNutrition(nutritionPer100g.carbohydrateG * multiplier),
        fatG: roundNutrition(nutritionPer100g.fatG * multiplier),
      },
    });
    await tx.insert(userRecords).values({
      userId,
      entity: "food_log",
      recordId: parsed.data.logId,
      version: 1,
      data,
      deleted: false,
      serverUpdatedAt: new Date(),
    });
    await appendSyncChange(tx, userId, "food_log", parsed.data.logId, data);
    return { status: "saved" as const, data, version: 1, idempotent: false };
  });
  if (result.status === "food_not_found") return c.json({ error: "food_not_found" }, 404);
  if (result.status === "portion_invalid") return c.json({ error: "food_portion_invalid" }, 400);
  if (result.status === "conflict") return c.json({ error: "food_log_id_conflict" }, 409);
  return c.json({ id: parsed.data.logId, version: result.version, data: result.data, idempotent: result.idempotent }, result.idempotent ? 200 : 201);
});

app.post("/v1/food-logs/copy", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = copyFoodLogsRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_food_log_copy" }, 400);
  if (!isLocalDate(parsed.data.sourceDate) || !isLocalDate(parsed.data.targetDate)) {
    return c.json({ error: "invalid_food_log_copy" }, 400);
  }
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [profile] = await tx.select({ data: userProfiles.data }).from(userProfiles)
      .where(eq(userProfiles.userId, userId)).limit(1);
    const savedProfile = profileSchema.safeParse(profile?.data);
    let timezone = savedProfile.success ? savedProfile.data.timezone : "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      timezone = "UTC";
    }

    const requestedIds = parsed.data.entries.map((entry) => entry.sourceLogId);
    const sourceRows = await tx.select({ id: userRecords.recordId, data: userRecords.data }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "food_log"),
      inArray(userRecords.recordId, requestedIds),
      eq(userRecords.deleted, false),
    ));
    if (sourceRows.length !== requestedIds.length) return { status: "source_missing" as const };
    const sourceById = new Map(sourceRows.map((row) => [row.id, row.data]));
    const copies: Array<{ logId: string; data: ReturnType<typeof foodLogRecordSchema.parse> }> = [];
    for (const entry of parsed.data.entries) {
      const sourceData = foodLogRecordSchema.safeParse(sourceById.get(entry.sourceLogId));
      if (!sourceData.success || localDateInZone(sourceData.data.occurredAt, timezone) !== parsed.data.sourceDate) {
        return { status: "source_date_mismatch" as const };
      }
      if (sourceData.data.mealType !== parsed.data.mealType) return { status: "meal_mismatch" as const };
      const occurredAt = localDateTimeAtTargetInZone(sourceData.data.occurredAt, parsed.data.targetDate, timezone);
      if (!occurredAt) return { status: "target_time_invalid" as const };
      copies.push({ logId: entry.logId, data: { ...sourceData.data, occurredAt } });
    }

    const destinationIds = copies.map((entry) => entry.logId);
    const existingRows = await tx.select({ id: userRecords.recordId, data: userRecords.data, deleted: userRecords.deleted })
      .from(userRecords).where(and(
        eq(userRecords.userId, userId),
        eq(userRecords.entity, "food_log"),
        inArray(userRecords.recordId, destinationIds),
      ));
    const existingById = new Map(existingRows.map((row) => [row.id, row]));
    const pending: typeof copies = [];
    for (const copy of copies) {
      const existing = existingById.get(copy.logId);
      if (!existing) {
        pending.push(copy);
        continue;
      }
      const prior = foodLogRecordSchema.safeParse(existing.data);
      const same = !existing.deleted && prior.success
        && JSON.stringify(prior.data) === JSON.stringify(copy.data);
      if (!same) return { status: "conflict" as const };
    }
    for (const copy of pending) {
      await tx.insert(userRecords).values({
        userId,
        entity: "food_log",
        recordId: copy.logId,
        version: 1,
        data: copy.data,
        deleted: false,
        serverUpdatedAt: new Date(),
      });
      await appendSyncChange(tx, userId, "food_log", copy.logId, copy.data);
    }
    return { status: "copied" as const, copiedCount: copies.length, idempotent: pending.length === 0 };
  });
  if (result.status === "source_missing") return c.json({ error: "food_log_copy_source_not_found" }, 404);
  if (result.status === "source_date_mismatch") return c.json({ error: "food_log_copy_source_date_mismatch" }, 400);
  if (result.status === "meal_mismatch") return c.json({ error: "food_log_copy_meal_mismatch" }, 400);
  if (result.status === "target_time_invalid") return c.json({ error: "food_log_copy_time_invalid_for_target_date" }, 400);
  if (result.status === "conflict") return c.json({ error: "food_log_id_conflict" }, 409);
  return c.json({ copiedCount: result.copiedCount, idempotent: result.idempotent }, result.idempotent ? 200 : 201);
});

app.patch("/v1/food-logs/:id", async (c) => {
  const recordId = c.req.param("id");
  if (!isUuid(recordId)) return c.json({ error: "invalid_food_log_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = updateFoodLogRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_food_log_update" }, 400);
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [existing] = await tx.select({ data: userRecords.data, version: userRecords.version }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "food_log"),
      eq(userRecords.recordId, recordId),
      eq(userRecords.deleted, false),
    )).limit(1);
    if (!existing) return { status: "missing" as const };
    if (existing.version !== parsed.data.baseVersion) return { status: "conflict" as const, version: existing.version };
    const prior = foodLogRecordSchema.safeParse(existing.data);
    if (!prior.success) return { status: "invalid_record" as const };
    const quantityGrams = parsed.data.quantityGrams ?? prior.data.quantityGrams;
    const quantityChanged = quantityGrams !== prior.data.quantityGrams;
    const factor = quantityGrams / 100;
    const data = foodLogRecordSchema.parse({
      ...prior.data,
      ...(prior.data.foodEstimate && quantityChanged ? { foodEstimate: {
        ...prior.data.foodEstimate, minimumGrams: quantityGrams, maximumGrams: quantityGrams, userAdjusted: true,
      } } : {}),
      ...(prior.data.photoEstimate && quantityChanged ? { photoEstimate: {
        ...prior.data.photoEstimate, minimumGrams: quantityGrams, maximumGrams: quantityGrams, userAdjusted: true,
      } } : {}),
      occurredAt: parsed.data.occurredAt ?? prior.data.occurredAt,
      mealType: parsed.data.mealType ?? prior.data.mealType,
      quantityGrams,
      portionId: quantityChanged ? null : prior.data.portionId ?? null,
      portionLabel: quantityChanged ? null : prior.data.portionLabel ?? null,
      portionCount: quantityChanged ? null : prior.data.portionCount ?? null,
      nutritionTotal: {
        caloriesKcal: roundNutrition(prior.data.nutritionPer100g.caloriesKcal * factor),
        proteinG: roundNutrition(prior.data.nutritionPer100g.proteinG * factor),
        carbohydrateG: roundNutrition(prior.data.nutritionPer100g.carbohydrateG * factor),
        fatG: roundNutrition(prior.data.nutritionPer100g.fatG * factor),
      },
    });
    const version = existing.version + 1;
    const [saved] = await tx.update(userRecords).set({
      data,
      version,
      serverUpdatedAt: new Date(),
    }).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "food_log"),
      eq(userRecords.recordId, recordId),
      eq(userRecords.version, parsed.data.baseVersion),
      eq(userRecords.deleted, false),
    )).returning({ data: userRecords.data, version: userRecords.version });
    if (!saved) return { status: "conflict" as const, version: existing.version + 1 };
    await appendSyncChange(tx, userId, "food_log", recordId, data, version);
    return { status: "saved" as const, data: saved.data, version: saved.version };
  });
  if (result.status === "missing") return c.json({ error: "food_log_not_found" }, 404);
  if (result.status === "conflict") return c.json({ error: "food_log_version_conflict", currentVersion: result.version }, 409);
  if (result.status === "invalid_record") return c.json({ error: "food_log_record_invalid" }, 409);
  return c.json({ id: recordId, data: result.data, version: result.version });
});

app.delete("/v1/food-logs/:id", async (c) => {
  const recordId = c.req.param("id");
  if (!isUuid(recordId)) return c.json({ error: "invalid_food_log_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = deleteFoodLogRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_food_log_delete" }, 400);
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [existing] = await tx.select({ version: userRecords.version }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "food_log"),
      eq(userRecords.recordId, recordId),
      eq(userRecords.deleted, false),
    )).limit(1);
    if (!existing) return { status: "missing" as const };
    if (existing.version !== parsed.data.baseVersion) return { status: "conflict" as const, version: existing.version };
    const version = existing.version + 1;
    const [deleted] = await tx.update(userRecords).set({
      deleted: true,
      version,
      serverUpdatedAt: new Date(),
    }).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "food_log"),
      eq(userRecords.recordId, recordId),
      eq(userRecords.version, parsed.data.baseVersion),
      eq(userRecords.deleted, false),
    )).returning({ version: userRecords.version });
    if (!deleted) return { status: "conflict" as const, version: existing.version + 1 };
    await appendSyncChange(tx, userId, "food_log", recordId, null, version, true);
    return { status: "deleted" as const, version: deleted.version };
  });
  if (result.status === "missing") return c.json({ error: "food_log_not_found" }, 404);
  if (result.status === "conflict") return c.json({ error: "food_log_version_conflict", currentVersion: result.version }, 409);
  return c.json({ id: recordId, version: result.version, deleted: true });
});

app.post("/v1/activity-logs", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = createActivityLogRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_activity_log" }, 400);
  if (!isActivityEnergyKindAllowed(parsed.data.activityType, parsed.data.energyKind)) return c.json({ error: "invalid_activity_energy_kind" }, 400);
  const invalidExerciseReference = parsed.data.exercises?.some((exercise) => {
    if (!exercise.exerciseId) return false;
    const catalogExercise = findExerciseById(exercise.exerciseId);
    return !catalogExercise || catalogExercise.name !== exercise.exerciseName;
  });
  if (invalidExerciseReference) return c.json({ error: "invalid_exercise_reference" }, 400);
  const data = activityLogRecordSchema.parse({
    activityType: parsed.data.activityType,
    occurredAt: parsed.data.occurredAt,
    ...(parsed.data.energyKind ? { energyKind: parsed.data.energyKind } : {}),
    durationMinutes: parsed.data.durationMinutes,
    steps: parsed.data.steps,
    notes: parsed.data.notes,
    ...(parsed.data.workoutTitle ? { workoutTitle: parsed.data.workoutTitle } : {}),
    ...(parsed.data.exercises ? { exercises: parsed.data.exercises } : {}),
    ...(parsed.data.plannedSession ? { plannedSession: parsed.data.plannedSession } : {}),
  });
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"activity-log:" + userId + ":" + parsed.data.activityId}, 0))`);
    const [existing] = await tx.select({ data: userRecords.data, version: userRecords.version }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "activity_log"),
      eq(userRecords.recordId, parsed.data.activityId),
      eq(userRecords.deleted, false),
    )).limit(1);
    if (existing) {
      const prior = activityLogRecordSchema.safeParse(existing.data);
      const priorInput = prior.success ? { ...prior.data } : null;
      if (priorInput) delete priorInput.energyEstimate;
      const same = priorInput !== null && JSON.stringify(priorInput) === JSON.stringify(data);
      return { status: same ? "saved" as const : "conflict" as const, data: existing.data, version: existing.version, idempotent: same };
    }
    if (parsed.data.plannedSession && !await hasOwnedApprovedWorkoutSession(tx, userId, parsed.data.plannedSession)) {
      return { status: "planned_session_invalid" as const };
    }
    const recordedData = activityLogRecordSchema.parse({ ...data, energyEstimate: await buildActivityEnergyEstimate(tx, userId, data) });
    await tx.insert(userRecords).values({
      userId,
      entity: "activity_log",
      recordId: parsed.data.activityId,
      version: 1,
      data: recordedData,
      deleted: false,
      serverUpdatedAt: new Date(),
    });
    await appendSyncChange(tx, userId, "activity_log", parsed.data.activityId, recordedData);
    return { status: "saved" as const, data: recordedData, version: 1, idempotent: false };
  });
  if (result.status === "planned_session_invalid") return c.json({ error: "planned_workout_session_unavailable" }, 409);
  if (result.status === "conflict") return c.json({ error: "activity_log_id_conflict" }, 409);
  return c.json({ id: parsed.data.activityId, data: result.data, version: result.version, idempotent: result.idempotent }, result.idempotent ? 200 : 201);
});

app.patch("/v1/activity-logs/:id", async (c) => {
  const recordId = c.req.param("id");
  if (!isUuid(recordId)) return c.json({ error: "invalid_activity_log_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = updateActivityLogRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_activity_log_update" }, 400);
  if (!isActivityEnergyKindAllowed(parsed.data.activityType, parsed.data.energyKind)) return c.json({ error: "invalid_activity_energy_kind" }, 400);
  const invalidExerciseReference = parsed.data.exercises?.some((exercise) => {
    if (!exercise.exerciseId) return false;
    const catalogExercise = findExerciseById(exercise.exerciseId);
    return !catalogExercise || catalogExercise.name !== exercise.exerciseName;
  });
  if (invalidExerciseReference) return c.json({ error: "invalid_exercise_reference" }, 400);
  const data = activityLogRecordSchema.parse({
    activityType: parsed.data.activityType,
    occurredAt: parsed.data.occurredAt,
    ...(parsed.data.energyKind ? { energyKind: parsed.data.energyKind } : {}),
    durationMinutes: parsed.data.durationMinutes,
    steps: parsed.data.steps,
    notes: parsed.data.notes,
    ...(parsed.data.workoutTitle ? { workoutTitle: parsed.data.workoutTitle } : {}),
    ...(parsed.data.exercises ? { exercises: parsed.data.exercises } : {}),
    ...(parsed.data.plannedSession ? { plannedSession: parsed.data.plannedSession } : {}),
  });
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [existing] = await tx.select({ data: userRecords.data, version: userRecords.version }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "activity_log"),
      eq(userRecords.recordId, recordId),
      eq(userRecords.deleted, false),
    )).limit(1);
    if (!existing) return { status: "missing" as const };
    if (existing.version !== parsed.data.baseVersion) return { status: "conflict" as const, version: existing.version };
    const prior = activityLogRecordSchema.safeParse(existing.data);
    if (!prior.success) return { status: "invalid_record" as const };
    if (parsed.data.plannedSession && !await hasOwnedApprovedWorkoutSession(tx, userId, parsed.data.plannedSession)) {
      return { status: "planned_session_invalid" as const };
    }
    const recordedData = activityLogRecordSchema.parse({ ...data, energyEstimate: await buildActivityEnergyEstimate(tx, userId, data, prior.data) });
    const version = existing.version + 1;
    const [saved] = await tx.update(userRecords).set({
      data: recordedData,
      version,
      serverUpdatedAt: new Date(),
    }).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "activity_log"),
      eq(userRecords.recordId, recordId),
      eq(userRecords.version, parsed.data.baseVersion),
      eq(userRecords.deleted, false),
    )).returning({ data: userRecords.data, version: userRecords.version });
    if (!saved) return { status: "conflict" as const, version: existing.version + 1 };
    await appendSyncChange(tx, userId, "activity_log", recordId, recordedData, version);
    return { status: "saved" as const, data: saved.data, version: saved.version };
  });
  if (result.status === "planned_session_invalid") return c.json({ error: "planned_workout_session_unavailable" }, 409);
  if (result.status === "missing") return c.json({ error: "activity_log_not_found" }, 404);
  if (result.status === "conflict") return c.json({ error: "activity_log_version_conflict", currentVersion: result.version }, 409);
  if (result.status === "invalid_record") return c.json({ error: "activity_log_record_invalid" }, 409);
  return c.json({ id: recordId, data: result.data, version: result.version });
});

app.delete("/v1/activity-logs/:id", async (c) => {
  const recordId = c.req.param("id");
  if (!isUuid(recordId)) return c.json({ error: "invalid_activity_log_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = deleteActivityLogRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_activity_log_delete" }, 400);
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [existing] = await tx.select({ version: userRecords.version }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "activity_log"),
      eq(userRecords.recordId, recordId),
      eq(userRecords.deleted, false),
    )).limit(1);
    if (!existing) return { status: "missing" as const };
    if (existing.version !== parsed.data.baseVersion) return { status: "conflict" as const, version: existing.version };
    const version = existing.version + 1;
    const [deleted] = await tx.update(userRecords).set({ deleted: true, version, serverUpdatedAt: new Date() }).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "activity_log"),
      eq(userRecords.recordId, recordId),
      eq(userRecords.version, parsed.data.baseVersion),
      eq(userRecords.deleted, false),
    )).returning({ version: userRecords.version });
    if (!deleted) return { status: "conflict" as const, version: existing.version + 1 };
    await appendSyncChange(tx, userId, "activity_log", recordId, null, version, true);
    return { status: "deleted" as const, version: deleted.version };
  });
  if (result.status === "missing") return c.json({ error: "activity_log_not_found" }, 404);
  if (result.status === "conflict") return c.json({ error: "activity_log_version_conflict", currentVersion: result.version }, 409);
  return c.json({ id: recordId, version: result.version, deleted: true });
});

app.get("/v1/days/:date", async (c) => {
  const date = c.req.param("date");
  if (!isLocalDate(date)) return c.json({ error: "invalid_local_date" }, 400);
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [profile] = await tx.select({ data: userProfiles.data }).from(userProfiles)
      .where(eq(userProfiles.userId, userId)).limit(1);
    const savedProfile = profileSchema.safeParse(profile?.data);
    const timezone = savedProfile.success ? savedProfile.data.timezone : "UTC";
    const foodRecords = await tx.select({ id: userRecords.recordId, version: userRecords.version, data: userRecords.data }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "food_log"),
      eq(userRecords.deleted, false),
    ));
    const activityRecords = await tx.select({ id: userRecords.recordId, version: userRecords.version, data: userRecords.data }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "activity_log"),
      eq(userRecords.deleted, false),
    ));
    const measurementRecords = await tx.select({ id: userRecords.recordId, data: userRecords.data }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "body_measurement"),
      eq(userRecords.deleted, false),
    ));
    const estimateEnergy = createActivityEnergyEstimator(profile?.data, measurementRecords);
    const [status] = await tx.select({ complete: foodDayStatuses.complete }).from(foodDayStatuses).where(and(
      eq(foodDayStatuses.userId, userId),
      eq(foodDayStatuses.localDate, date),
    )).limit(1);
    return { timezone, foodRecords, activityRecords, estimateEnergy, foodDayComplete: status?.complete ?? false };
  });
  let timezone = result.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    timezone = "UTC";
  }
  const foodLogs = result.foodRecords.flatMap((record) => {
    const parsed = foodLogRecordSchema.safeParse(record.data);
    return parsed.success && localDateInZone(parsed.data.occurredAt, timezone) === date
      ? [{ id: record.id, version: record.version, data: parsed.data }]
      : [];
  }).sort((a, b) => a.data.occurredAt.localeCompare(b.data.occurredAt));
  const activityLogs = result.activityRecords.flatMap((record) => {
    const parsed = activityLogRecordSchema.safeParse(record.data);
    if (!parsed.success || localDateInZone(parsed.data.occurredAt, timezone) !== date) return [];
    // Old entries gain a response-only estimate; never rewrite saved history on a GET.
    const energyEstimate = parsed.data.energyEstimate ?? result.estimateEnergy(parsed.data);
    return [{
      id: record.id,
      version: record.version,
      data: { ...parsed.data, energyEstimate },
      energyEstimateSource: parsed.data.energyEstimate ? "saved" : energyEstimate ? "calculated" : null,
    }];
  }).sort((a, b) => a.data.occurredAt.localeCompare(b.data.occurredAt));
  const foodTotals = foodLogs.reduce((totals, item) => ({
    caloriesKcal: roundNutrition(totals.caloriesKcal + item.data.nutritionTotal.caloriesKcal),
    proteinG: roundNutrition(totals.proteinG + item.data.nutritionTotal.proteinG),
    carbohydrateG: roundNutrition(totals.carbohydrateG + item.data.nutritionTotal.carbohydrateG),
    fatG: roundNutrition(totals.fatG + item.data.nutritionTotal.fatG),
  }), { caloriesKcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 });
  const steps = activityLogs.filter((item) => item.data.activityType === "steps")
    .reduce((total, item) => total + (item.data.steps ?? 0), 0);
  const workoutsCompleted = activityLogs.filter((item) => ["strength", "cardio", "walk"].includes(item.data.activityType)).length;
  const activityEnergy = summarizeActivityEnergy(activityLogs.map((item) => item.data));
  return c.json({ date, timezone, foodLogs, activityLogs, foodTotals, steps, workoutsCompleted, activityEnergy, foodDayComplete: result.foodDayComplete });
});

app.get("/v1/progress/weekly-review", async (c) => {
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [profileRecord] = await tx.select({ data: userProfiles.data }).from(userProfiles)
      .where(eq(userProfiles.userId, userId)).limit(1);
    const parsedProfile = profileSchema.safeParse(profileRecord?.data);
    let timezone = parsedProfile.success ? parsedProfile.data.timezone : "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      timezone = "UTC";
    }
    const endDate = localDateInZone(new Date().toISOString(), timezone);
    const startDate = shiftLocalDate(endDate, -6);
    const trendStartDate = shiftLocalDate(endDate, -27);
    const rangeQueryStart = shiftLocalDate(startDate, -2);
    const rangeQueryEnd = shiftLocalDate(endDate, 2);
    const trendQueryStart = shiftLocalDate(trendStartDate, -2);
    const goalRows = await tx.select({ data: userRecords.data }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "goal"),
      eq(userRecords.deleted, false),
    )).orderBy(desc(userRecords.serverUpdatedAt)).limit(100);
    const foodRows = await tx.select({ data: userRecords.data }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "food_log"),
      eq(userRecords.deleted, false),
      sql`left(${userRecords.data}->>'occurredAt', 10) >= ${rangeQueryStart}`,
      sql`left(${userRecords.data}->>'occurredAt', 10) <= ${rangeQueryEnd}`,
    ));
    const activityRows = await tx.select({ data: userRecords.data }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "activity_log"),
      eq(userRecords.deleted, false),
      sql`left(${userRecords.data}->>'occurredAt', 10) >= ${rangeQueryStart}`,
      sql`left(${userRecords.data}->>'occurredAt', 10) <= ${rangeQueryEnd}`,
    ));
    const measurementRows = await tx.select({ data: userRecords.data }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "body_measurement"),
      eq(userRecords.deleted, false),
      sql`left(${userRecords.data}->>'measuredAt', 10) >= ${trendQueryStart}`,
      sql`left(${userRecords.data}->>'measuredAt', 10) <= ${rangeQueryEnd}`,
    ));
    const dayDates = Array.from({ length: 7 }, (_, index) => shiftLocalDate(startDate, index));
    const statusRows = await tx.select({ localDate: foodDayStatuses.localDate, complete: foodDayStatuses.complete })
      .from(foodDayStatuses).where(and(
        eq(foodDayStatuses.userId, userId),
        inArray(foodDayStatuses.localDate, dayDates),
      ));
    return { timezone, startDate, endDate, dayDates, goalRows, foodRows, activityRows, measurementRows, statusRows };
  });

  const goals = result.goalRows.flatMap((row) => {
    const parsed = goalSchema.safeParse(row.data);
    return parsed.success ? [parsed.data] : [];
  }).sort((left, right) => right.goalVersion - left.goalVersion);
  const currentGoal = goals[0] ?? null;
  const foodByDate = new Map<string, { count: number; calories: number; protein: number }>();
  for (const row of result.foodRows) {
    const parsed = foodLogRecordSchema.safeParse(row.data);
    if (!parsed.success) continue;
    const date = localDateInZone(parsed.data.occurredAt, result.timezone);
    if (date < result.startDate || date > result.endDate) continue;
    const totals = foodByDate.get(date) ?? { count: 0, calories: 0, protein: 0 };
    totals.count += 1;
    totals.calories += parsed.data.nutritionTotal.caloriesKcal;
    totals.protein += parsed.data.nutritionTotal.proteinG;
    foodByDate.set(date, totals);
  }

  const activityByDate = new Map<string, { workoutSessions: number; hasSteps: boolean; steps: number }>();
  for (const row of result.activityRows) {
    const parsed = activityLogRecordSchema.safeParse(row.data);
    if (!parsed.success) continue;
    const date = localDateInZone(parsed.data.occurredAt, result.timezone);
    if (date < result.startDate || date > result.endDate) continue;
    const totals = activityByDate.get(date) ?? { workoutSessions: 0, hasSteps: false, steps: 0 };
    if (["walk", "cardio", "strength"].includes(parsed.data.activityType)) totals.workoutSessions += 1;
    if (parsed.data.activityType === "steps" && parsed.data.steps !== null) {
      totals.hasSteps = true;
      totals.steps += parsed.data.steps;
    }
    activityByDate.set(date, totals);
  }

  const measurementRecordSchema = createMeasurementRequestSchema.omit({ measurementId: true });
  const measurementValuesByDate = new Map<string, number[]>();
  const recentMeasurementDates = new Set<string>();
  for (const row of result.measurementRows) {
    const parsed = measurementRecordSchema.safeParse(row.data);
    if (!parsed.success) continue;
    const date = localDateInZone(parsed.data.measuredAt, result.timezone);
    if (date >= result.startDate && date <= result.endDate) {
      const values = measurementValuesByDate.get(date) ?? [];
      values.push(parsed.data.weightKg);
      measurementValuesByDate.set(date, values);
    }
    if (date >= shiftLocalDate(result.endDate, -27) && date <= result.endDate) recentMeasurementDates.add(date);
  }
  const dailyWeightByDate = new Map([...measurementValuesByDate.entries()].flatMap(([date, values]) => {
    const value = median(values);
    return value === null ? [] : [[date, value] as const];
  }));
  const completeFoodDates = new Set(result.statusRows.filter((row) => row.complete).map((row) => row.localDate));
  const days: WeeklyProgressReviewResponse["days"] = result.dayDates.map((date) => {
    const food = foodByDate.get(date);
    const activity = activityByDate.get(date);
    const complete = completeFoodDates.has(date);
    return {
      date,
      foodLogCount: food?.count ?? 0,
      foodDayComplete: complete,
      caloriesLoggedKcal: food?.count || complete ? roundNutrition(food?.calories ?? 0) : null,
      proteinLoggedG: food?.count || complete ? roundNutrition(food?.protein ?? 0) : null,
      workoutSessions: activity?.workoutSessions ?? 0,
      steps: activity?.hasSteps ? activity.steps : null,
      measurementWeightKg: dailyWeightByDate.get(date) ?? null,
      plannedWeightKg: currentGoal && date >= currentGoal.startDate && date <= currentGoal.targetDate
        ? goalWeightAt(currentGoal, date)
        : null,
    };
  });
  const completeDays = days.filter((day) => day.foodDayComplete);
  const workoutDays = days.filter((day) => day.workoutSessions > 0);
  const stepDays = days.filter((day) => day.steps !== null);
  const weighedDays = [...dailyWeightByDate.entries()].sort(([left], [right]) => left.localeCompare(right));
  const firstWeighIn = weighedDays[0] ?? null;
  const lastWeighIn = weighedDays.at(-1) ?? null;
  const trendDates = [...recentMeasurementDates].sort();
  const trendFirstDate = trendDates[0] ?? null;
  const trendLastDate = trendDates.at(-1) ?? null;
  const trendSpanDays = trendFirstDate && trendLastDate ? daySpan(trendFirstDate, trendLastDate) : 0;
  const latestPlanComparison = lastWeighIn && currentGoal
    && lastWeighIn[0] >= currentGoal.startDate && lastWeighIn[0] <= currentGoal.targetDate
    ? {
        date: lastWeighIn[0],
        measuredWeightKg: lastWeighIn[1],
        plannedWeightKg: goalWeightAt(currentGoal, lastWeighIn[0]),
        differenceKg: roundNutrition(lastWeighIn[1] - goalWeightAt(currentGoal, lastWeighIn[0])),
      }
    : null;
  const response: WeeklyProgressReviewResponse = {
    timezone: result.timezone,
    startDate: result.startDate,
    endDate: result.endDate,
    dailyTargets: {
      caloriesKcal: currentGoal?.dailyCaloriesKcal ?? null,
      proteinG: currentGoal?.macrosGrams?.protein ?? null,
    },
    days,
    summary: {
      completeFoodDays: completeDays.length,
      foodDaysWithLogs: days.filter((day) => day.foodLogCount > 0).length,
      averageCaloriesOnCompleteDaysKcal: completeDays.length
        ? roundNutrition(completeDays.reduce((total, day) => total + (day.caloriesLoggedKcal ?? 0), 0) / completeDays.length)
        : null,
      averageProteinOnCompleteDaysG: completeDays.length
        ? roundNutrition(completeDays.reduce((total, day) => total + (day.proteinLoggedG ?? 0), 0) / completeDays.length)
        : null,
      workoutDays: workoutDays.length,
      workoutSessions: days.reduce((total, day) => total + day.workoutSessions, 0),
      stepDays: stepDays.length,
      averageStepsOnLoggedDays: stepDays.length
        ? roundNutrition(stepDays.reduce((total, day) => total + (day.steps ?? 0), 0) / stepDays.length)
        : null,
      weighInDays: weighedDays.length,
      firstWeighInDate: firstWeighIn?.[0] ?? null,
      lastWeighInDate: lastWeighIn?.[0] ?? null,
      recordedWeightChangeKg: firstWeighIn && lastWeighIn && firstWeighIn[0] !== lastWeighIn[0]
        ? roundNutrition(lastWeighIn[1] - firstWeighIn[1])
        : null,
      latestPlanComparison,
    },
    trendReadiness: {
      eligible: recentMeasurementDates.size >= 6 && trendSpanDays >= 14,
      measurementDays: recentMeasurementDates.size,
      spanDays: trendSpanDays,
      firstMeasurementDate: trendFirstDate,
      lastMeasurementDate: trendLastDate,
      windowStartDate: shiftLocalDate(result.endDate, -27),
      windowEndDate: result.endDate,
      requiredMeasurementDays: 6,
      requiredSpanDays: 14,
    },
  };
  const validated = weeklyProgressReviewResponseSchema.safeParse(response);
  if (!validated.success) return c.json({ error: "weekly_progress_review_unavailable" }, 500);
  return c.json(validated.data);
});

app.put("/v1/days/:date/food-status", async (c) => {
  const date = c.req.param("date");
  if (!isLocalDate(date)) return c.json({ error: "invalid_local_date" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = foodDayStatusRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_food_day_status" }, 400);
  const userId = c.get("session").user.id;
  const [saved] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return tx.insert(foodDayStatuses).values({
      userId,
      localDate: date,
      complete: parsed.data.complete,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [foodDayStatuses.userId, foodDayStatuses.localDate],
      set: { complete: parsed.data.complete, updatedAt: new Date() },
    }).returning({ localDate: foodDayStatuses.localDate, complete: foodDayStatuses.complete, updatedAt: foodDayStatuses.updatedAt });
  });
  return c.json(saved);
});

app.get("/v1/meal-plans", async (c) => {
  const userId = c.get("session").user.id;
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return tx.select().from(plans).where(and(
      eq(plans.userId, userId), eq(plans.kind, "meal"),
    )).orderBy(desc(plans.updatedAt)).limit(100);
  });
  return c.json({ plans: rows.map(mealPlanResponse).filter((plan) => plan !== null) });
});

app.post("/v1/plans/meal/runs", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = mealPlanRunRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_meal_plan_request" }, 400);
  if (!isLocalDate(parsed.data.startDate)) return c.json({ error: "invalid_start_date" }, 400);
  if (!env.GEMINI_API_KEY) return c.json({ error: "meal_planning_not_configured" }, 503);

  const userId = c.get("session").user.id;
  let planning;
  try {
    planning = await buildMealPlanningContext(userId, parsed.data.startDate);
  } catch (error) {
    const code = error instanceof Error ? error.message : "meal_plan_context_unavailable";
    const statusByCode: Record<string, 409 | 422 | 503> = {
      profile_or_accepted_goal_required: 409,
      accepted_calorie_target_required: 409,
      meal_planning_not_available_for_this_profile: 422,
      meal_plan_food_metadata_required: 422,
      meal_plan_catalog_coverage_insufficient: 422,
    };
    return c.json({ error: statusByCode[code] ? code : "meal_plan_context_unavailable" }, statusByCode[code] ?? 503);
  }
  const today = localDateInZone(new Date().toISOString(), planning.context.timezone);
  if (parsed.data.startDate < today || parsed.data.startDate > shiftLocalDate(today, 30)) {
    return c.json({ error: "meal_plan_start_date_out_of_range" }, 422);
  }
  const inputHash = hashMealPlanningContext(planning.context);
  const runId = randomUUID();
  const runSetup = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    await lockAiUsageWindow(tx, userId);
    const [prior] = await tx.select().from(aiRuns).where(and(
      eq(aiRuns.userId, userId), eq(aiRuns.kind, "meal_plan"), eq(aiRuns.idempotencyKey, parsed.data.idempotencyKey),
    )).limit(1);
    if (prior) {
      if (prior.inputHash !== inputHash) return { status: "idempotency_conflict" as const };
      const [plan] = prior.resultPlanId ? await tx.select().from(plans).where(and(
        eq(plans.userId, userId), eq(plans.id, prior.resultPlanId), eq(plans.kind, "meal"),
      )).limit(1) : [];
      return { status: "existing" as const, run: prior, plan };
    }
    const [active] = await tx.select().from(plans).where(and(
      eq(plans.userId, userId), eq(plans.kind, "meal"), eq(plans.status, "active"),
    )).orderBy(desc(plans.version)).limit(1);
    const [draft] = await tx.select({ id: plans.id }).from(plans).where(and(
      eq(plans.userId, userId), eq(plans.kind, "meal"), eq(plans.status, "draft"),
    )).limit(1);
    if (draft) return { status: "draft_conflict" as const, planId: draft.id };
    if (!(await hasAiOperationCapacity(tx, userId))) return { status: "quota_exceeded" as const };
    const groupId = active?.groupId ?? runId;
    const [latest] = await tx.select({ version: plans.version }).from(plans).where(and(
      eq(plans.userId, userId), eq(plans.groupId, groupId), eq(plans.kind, "meal"),
    )).orderBy(desc(plans.version)).limit(1);
    const [created] = await tx.insert(aiRuns).values({
      id: runId,
      userId,
      kind: "meal_plan",
      status: "running",
      idempotencyKey: parsed.data.idempotencyKey,
      inputHash,
      inputSnapshot: { ...planning.context },
      model: mealPlanningVersions.model,
      promptVersion: mealPlanningVersions.prompt,
      schemaVersion: mealPlanningVersions.schema,
    }).onConflictDoNothing().returning();
    if (!created) return { status: "idempotency_race" as const };
    return {
      status: "created" as const,
      groupId,
      planVersion: (latest?.version ?? 0) + 1,
    };
  });
  if (runSetup.status === "draft_conflict") return c.json({ error: "meal_plan_draft_exists", planId: runSetup.planId }, 409);
  if (runSetup.status === "quota_exceeded") return c.json({ error: "ai_daily_limit_reached" }, 429);
  if (runSetup.status === "idempotency_conflict") return c.json({ error: "idempotency_key_reused_with_different_input" }, 409);
  if (runSetup.status === "idempotency_race") return c.json({ error: "meal_plan_run_in_progress" }, 409);
  if (runSetup.status === "existing") {
    const plan = runSetup.plan ? mealPlanResponse(runSetup.plan) : null;
    return c.json({ runId: runSetup.run.id, status: runSetup.run.status, plan, errorCode: runSetup.run.errorCode }, 200);
  }

  try {
    const result = await runMealPlan({
      userId,
      runId,
      idempotencyKey: parsed.data.idempotencyKey,
      groupId: runSetup.groupId,
      planVersion: runSetup.planVersion,
      inputHash,
      context: planning.context,
      candidates: planning.candidates,
    });
    const [planRow] = result.planId ? await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return tx.select().from(plans).where(and(
        eq(plans.userId, userId), eq(plans.id, result.planId!), eq(plans.kind, "meal"),
      )).limit(1);
    }) : [];
    const plan = planRow ? mealPlanResponse(planRow) : null;
    if (result.terminalStatus === "failed") return c.json({ runId, status: "failed", plan: null, error: "meal_plan_invalid" }, 422);
    return c.json({ runId, status: "pending_review", plan }, 201);
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith("gemini_http_")
      ? "meal_plan_provider_unavailable"
      : error instanceof Error && error.message === "gemini_not_configured"
        ? "meal_planning_not_configured"
        : "meal_plan_generation_failed";
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      await tx.update(aiRuns).set({ status: "failed", errorCode: code, updatedAt: new Date() })
        .where(and(eq(aiRuns.userId, userId), eq(aiRuns.id, runId), eq(aiRuns.status, "running")));
    });
    return c.json({ runId, status: "failed", error: code }, 502);
  }
});

app.get("/v1/ai-runs/:id", async (c) => {
  const runId = c.req.param("id");
  if (!isUuid(runId)) return c.json({ error: "invalid_ai_run_id" }, 400);
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [run] = await tx.select().from(aiRuns).where(and(
      eq(aiRuns.userId, userId), eq(aiRuns.id, runId),
    )).limit(1);
    if (!run) return null;
    const planKind = run.kind === "workout_plan" ? "workout" : "meal";
    const [plan] = run.resultPlanId ? await tx.select().from(plans).where(and(
      eq(plans.userId, userId), eq(plans.id, run.resultPlanId), eq(plans.kind, planKind),
    )).limit(1) : [];
    return { run, plan };
  });
  if (!result) return c.json({ error: "ai_run_not_found" }, 404);
  return c.json({
    run: {
      id: result.run.id,
      kind: result.run.kind,
      status: result.run.status,
      planId: result.run.resultPlanId,
      errorCode: result.run.errorCode,
      inputTokens: result.run.inputTokens,
      outputTokens: result.run.outputTokens,
      costUsdMicros: result.run.costUsdMicros,
      createdAt: result.run.createdAt.toISOString(),
      updatedAt: result.run.updatedAt.toISOString(),
    },
    plan: result.plan
      ? result.run.kind === "workout_plan" ? workoutPlanResponse(result.plan) : mealPlanResponse(result.plan)
      : null,
  });
});

app.patch("/v1/meal-plans/:id", async (c) => {
  const planId = c.req.param("id");
  if (!isUuid(planId)) return c.json({ error: "invalid_meal_plan_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = mealPlanEditRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_meal_plan_edit" }, 400);
  const userId = c.get("session").user.id;
  const [existing] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return tx.select().from(plans).where(and(
      eq(plans.userId, userId), eq(plans.id, planId), eq(plans.kind, "meal"), eq(plans.status, "draft"),
    )).limit(1);
  });
  if (!existing) return c.json({ error: "meal_plan_draft_not_found" }, 404);
  if (existing.editVersion !== parsed.data.baseEditVersion) {
    return c.json({ error: "meal_plan_version_conflict", currentEditVersion: existing.editVersion }, 409);
  }
  const currentData = mealPlanDataSchema.safeParse(existing.data);
  if (!currentData.success) return c.json({ error: "meal_plan_invalid" }, 409);
  let data;
  try {
    data = await recalculateMealPlanEdit(userId, parsed.data, currentData.data.dailyCalorieTargetKcal, currentData.data.macroTargetsGrams);
  } catch (error) {
    const code = error instanceof Error ? error.message : "meal_plan_edit_invalid";
    return c.json({ error: ["meal_plan_foods_required", "meal_plan_food_not_available", "meal_plan_edit_invalid", "meal_plan_food_metadata_required", "meal_plan_vegetarian_day_food_required"].includes(code) ? code : "meal_plan_edit_invalid" }, 422);
  }
  const [saved] = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return tx.update(plans).set({
      data,
      source: "manual",
      editVersion: existing.editVersion + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(plans.userId, userId), eq(plans.id, planId), eq(plans.kind, "meal"),
      eq(plans.status, "draft"), eq(plans.editVersion, parsed.data.baseEditVersion),
    )).returning();
  });
  if (!saved) return c.json({ error: "meal_plan_version_conflict" }, 409);
  const plan = mealPlanResponse(saved);
  if (!plan) return c.json({ error: "meal_plan_save_failed" }, 500);
  return c.json({ plan });
});

app.post("/v1/meal-plans/:id/approve", async (c) => {
  const planId = c.req.param("id");
  if (!isUuid(planId)) return c.json({ error: "invalid_meal_plan_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = approveMealPlanRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_meal_plan_approval" }, 400);
  const userId = c.get("session").user.id;
  const reviewState = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [run] = await tx.select().from(aiRuns).where(and(
      eq(aiRuns.userId, userId), eq(aiRuns.kind, "meal_plan"), eq(aiRuns.resultPlanId, planId),
    )).limit(1);
    const [plan] = await tx.select().from(plans).where(and(
      eq(plans.userId, userId), eq(plans.id, planId), eq(plans.kind, "meal"),
    )).limit(1);
    return { run, plan };
  });
  if (!reviewState.run || !reviewState.plan) return c.json({ error: "meal_plan_review_not_found" }, 404);
  if (reviewState.run.status === "completed" || reviewState.run.status === "rejected") {
    return c.json({ status: reviewState.run.status, plan: mealPlanResponse(reviewState.plan) });
  }
  if (reviewState.run.status !== "pending_review" || reviewState.plan.status !== "draft") {
    return c.json({ error: "meal_plan_review_not_available", status: reviewState.run.status }, 409);
  }
  if (reviewState.plan.editVersion !== parsed.data.baseEditVersion) {
    return c.json({ error: "meal_plan_version_conflict", currentEditVersion: reviewState.plan.editVersion }, 409);
  }
  try {
    const result = await resumeMealPlan(reviewState.run.id, parsed.data);
    if (result.terminalStatus === "stale") return c.json({ error: "meal_plan_review_stale" }, 409);
    const [updated] = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return tx.select().from(plans).where(and(eq(plans.userId, userId), eq(plans.id, planId), eq(plans.kind, "meal"))).limit(1);
    });
    const plan = updated ? mealPlanResponse(updated) : null;
    return c.json({ status: result.terminalStatus, plan });
  } catch {
    return c.json({ error: "meal_plan_review_failed" }, 409);
  }
});

app.get("/v1/workout-plans", async (c) => {
  const userId = c.get("session").user.id;
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return tx.select().from(plans).where(and(
      eq(plans.userId, userId),
      eq(plans.kind, "workout"),
    )).orderBy(desc(plans.updatedAt)).limit(100);
  });
  return c.json({ plans: rows.map(workoutPlanResponse).filter((plan) => plan !== null) });
});

app.post("/v1/workout-plans", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = createWorkoutPlanRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_workout_plan" }, 400);
  if (!hasValidPlanExercises(parsed.data.data)) return c.json({ error: "invalid_exercise_reference" }, 400);
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [existingId] = await tx.select({ id: plans.id }).from(plans).where(and(
      eq(plans.userId, userId), eq(plans.id, parsed.data.planId),
    )).limit(1);
    if (existingId) return { status: "id_conflict" as const };
    const [existingDraft] = await tx.select({ id: plans.id }).from(plans).where(and(
      eq(plans.userId, userId), eq(plans.groupId, parsed.data.groupId), eq(plans.status, "draft"),
    )).limit(1);
    if (existingDraft) return { status: "draft_conflict" as const };
    const [saved] = await tx.insert(plans).values({
      id: parsed.data.planId,
      userId,
      groupId: parsed.data.groupId,
      kind: "workout",
      version: 1,
      editVersion: 1,
      status: "draft",
      source: parsed.data.source,
      data: parsed.data.data,
    }).returning();
    return saved ? { status: "saved" as const, row: saved } : { status: "save_failed" as const };
  });
  if (result.status === "id_conflict") return c.json({ error: "workout_plan_id_conflict" }, 409);
  if (result.status === "draft_conflict") return c.json({ error: "workout_plan_draft_exists" }, 409);
  if (result.status === "save_failed") return c.json({ error: "workout_plan_save_failed" }, 500);
  const plan = workoutPlanResponse(result.row);
  if (!plan) return c.json({ error: "workout_plan_save_failed" }, 500);
  return c.json({ plan }, 201);
});

app.patch("/v1/workout-plans/:id", async (c) => {
  const planId = c.req.param("id");
  if (!isUuid(planId)) return c.json({ error: "invalid_workout_plan_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = updateWorkoutPlanRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_workout_plan_update" }, 400);
  if (!hasValidPlanExercises(parsed.data.data)) return c.json({ error: "invalid_exercise_reference" }, 400);
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [existing] = await tx.select().from(plans).where(and(
      eq(plans.userId, userId), eq(plans.id, planId), eq(plans.kind, "workout"),
    )).for("update").limit(1);
    if (!existing) return { status: "missing" as const };
    if (existing.status !== "draft") return { status: "not_draft" as const };
    if (existing.editVersion !== parsed.data.baseEditVersion) return { status: "conflict" as const, version: existing.editVersion };
    const [saved] = await tx.update(plans).set({
      data: parsed.data.data,
      source: existing.source === "ai" ? "ai" : "manual",
      editVersion: existing.editVersion + 1,
      updatedAt: new Date(),
    }).where(and(
      eq(plans.userId, userId), eq(plans.id, planId), eq(plans.status, "draft"), eq(plans.editVersion, parsed.data.baseEditVersion),
    )).returning();
    return saved ? { status: "saved" as const, row: saved } : { status: "conflict" as const, version: existing.editVersion + 1 };
  });
  if (result.status === "missing") return c.json({ error: "workout_plan_not_found" }, 404);
  if (result.status === "not_draft") return c.json({ error: "approved_workout_plan_is_immutable" }, 409);
  if (result.status === "conflict") return c.json({ error: "workout_plan_version_conflict", currentEditVersion: result.version }, 409);
  const plan = workoutPlanResponse(result.row);
  if (!plan) return c.json({ error: "workout_plan_save_failed" }, 500);
  return c.json({ plan });
});

app.post("/v1/workout-plans/:id/revise", async (c) => {
  const planId = c.req.param("id");
  if (!isUuid(planId)) return c.json({ error: "invalid_workout_plan_id" }, 400);
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [active] = await tx.select().from(plans).where(and(
      eq(plans.userId, userId), eq(plans.id, planId), eq(plans.status, "active"), eq(plans.kind, "workout"),
    )).for("update").limit(1);
    if (!active) return { status: "missing" as const };
    const [draft] = await tx.select({ id: plans.id }).from(plans).where(and(
      eq(plans.userId, userId), eq(plans.groupId, active.groupId), eq(plans.status, "draft"),
    )).limit(1);
    if (draft) return { status: "draft_exists" as const, id: draft.id };
    const [latest] = await tx.select({ version: plans.version }).from(plans).where(and(
      eq(plans.userId, userId), eq(plans.groupId, active.groupId),
    )).orderBy(desc(plans.version)).limit(1);
    const [saved] = await tx.insert(plans).values({
      userId,
      groupId: active.groupId,
      kind: "workout",
      version: (latest?.version ?? active.version) + 1,
      editVersion: 1,
      status: "draft",
      source: "manual",
      data: active.data,
    }).returning();
    return saved ? { status: "saved" as const, row: saved } : { status: "save_failed" as const };
  });
  if (result.status === "missing") return c.json({ error: "active_workout_plan_not_found" }, 404);
  if (result.status === "draft_exists") return c.json({ error: "workout_plan_draft_exists", draftId: result.id }, 409);
  if (result.status === "save_failed") return c.json({ error: "workout_plan_revision_failed" }, 500);
  const plan = workoutPlanResponse(result.row);
  if (!plan) return c.json({ error: "workout_plan_revision_failed" }, 500);
  return c.json({ plan }, 201);
});

app.post("/v1/workout-plans/:id/approve", async (c) => {
  const planId = c.req.param("id");
  if (!isUuid(planId)) return c.json({ error: "invalid_workout_plan_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = approveWorkoutPlanRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_workout_plan_approval" }, 400);
  const userId = c.get("session").user.id;
  const workflowRun = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [run] = await tx.select().from(aiRuns).where(and(
      eq(aiRuns.userId, userId), eq(aiRuns.kind, "workout_plan"), eq(aiRuns.resultPlanId, planId),
    )).limit(1);
    return run;
  });
  if (workflowRun) {
    if (workflowRun.status !== "pending_review") {
      return c.json({ error: "workout_plan_review_not_available", status: workflowRun.status }, 409);
    }
    const [draft] = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return tx.select().from(plans).where(and(
        eq(plans.userId, userId), eq(plans.id, planId), eq(plans.kind, "workout"), eq(plans.status, "draft"),
      )).limit(1);
    });
    if (!draft) return c.json({ error: "workout_plan_draft_not_found" }, 404);
    if (draft.editVersion !== parsed.data.baseEditVersion) {
      return c.json({ error: "workout_plan_version_conflict", currentEditVersion: draft.editVersion }, 409);
    }
    try {
      const resumed = await resumeWorkoutPlan(workflowRun.id, { decision: "approve", baseEditVersion: parsed.data.baseEditVersion });
      if (resumed.terminalStatus === "stale") return c.json({ error: "workout_plan_review_stale" }, 409);
      const [updated] = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
        return tx.select().from(plans).where(and(eq(plans.userId, userId), eq(plans.id, planId), eq(plans.kind, "workout"))).limit(1);
      });
      const plan = updated ? workoutPlanResponse(updated) : null;
      return plan ? c.json({ plan }) : c.json({ error: "workout_plan_approval_failed" }, 500);
    } catch {
      return c.json({ error: "workout_plan_review_failed" }, 409);
    }
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [draft] = await tx.select().from(plans).where(and(
      eq(plans.userId, userId), eq(plans.id, planId), eq(plans.kind, "workout"), eq(plans.status, "draft"),
    )).for("update").limit(1);
    if (!draft) return { status: "missing" as const };
    if (draft.editVersion !== parsed.data.baseEditVersion) return { status: "conflict" as const, version: draft.editVersion };
    const data = workoutPlanDataSchema.safeParse(draft.data);
    if (!data.success || !hasValidPlanExercises(data.data)) return { status: "invalid" as const };
    const now = new Date();
    await tx.update(plans).set({ status: "superseded", updatedAt: now }).where(and(
      eq(plans.userId, userId), eq(plans.groupId, draft.groupId), eq(plans.status, "active"),
    ));
    const [saved] = await tx.update(plans).set({
      status: "active",
      approvedAt: now,
      updatedAt: now,
    }).where(and(
      eq(plans.userId, userId), eq(plans.id, planId), eq(plans.status, "draft"), eq(plans.editVersion, parsed.data.baseEditVersion),
    )).returning();
    return saved ? { status: "approved" as const, row: saved } : { status: "conflict" as const, version: draft.editVersion + 1 };
  });
  if (result.status === "missing") return c.json({ error: "workout_plan_draft_not_found" }, 404);
  if (result.status === "conflict") return c.json({ error: "workout_plan_version_conflict", currentEditVersion: result.version }, 409);
  if (result.status === "invalid") return c.json({ error: "workout_plan_invalid" }, 409);
  const plan = workoutPlanResponse(result.row);
  if (!plan) return c.json({ error: "workout_plan_approval_failed" }, 500);
  return c.json({ plan });
});

app.post("/v1/workout-plans/:id/reject", async (c) => {
  const planId = c.req.param("id");
  if (!isUuid(planId)) return c.json({ error: "invalid_workout_plan_id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = approveWorkoutPlanRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_workout_plan_rejection" }, 400);
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [run] = await tx.select().from(aiRuns).where(and(
      eq(aiRuns.userId, userId), eq(aiRuns.kind, "workout_plan"), eq(aiRuns.resultPlanId, planId),
    )).limit(1);
    const [draft] = await tx.select().from(plans).where(and(
      eq(plans.userId, userId), eq(plans.id, planId), eq(plans.kind, "workout"), eq(plans.status, "draft"),
    )).limit(1);
    return { run, draft };
  });
  if (!result.run || !result.draft) return c.json({ error: "ai_workout_plan_not_found" }, 404);
  if (result.run.status !== "pending_review") return c.json({ error: "workout_plan_review_not_available", status: result.run.status }, 409);
  if (result.draft.editVersion !== parsed.data.baseEditVersion) {
    return c.json({ error: "workout_plan_version_conflict", currentEditVersion: result.draft.editVersion }, 409);
  }
  try {
    const resumed = await resumeWorkoutPlan(result.run.id, { decision: "reject", baseEditVersion: parsed.data.baseEditVersion });
    if (resumed.terminalStatus !== "rejected") return c.json({ error: "workout_plan_rejection_failed" }, 409);
    const [archived] = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return tx.select().from(plans).where(and(eq(plans.userId, userId), eq(plans.id, planId), eq(plans.kind, "workout"))).limit(1);
    });
    const plan = archived ? workoutPlanResponse(archived) : null;
    return plan ? c.json({ status: "rejected", plan }) : c.json({ error: "workout_plan_rejection_failed" }, 500);
  } catch {
    return c.json({ error: "workout_plan_rejection_failed" }, 409);
  }
});

app.post("/v1/plans/workout/runs", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = workoutPlanRunRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_workout_plan_request" }, 400);
  if (!env.GEMINI_API_KEY) return c.json({ error: "workout_planning_not_configured" }, 503);

  const userId = c.get("session").user.id;
  let planning;
  try {
    planning = await buildWorkoutPlanningContext(userId);
  } catch (error) {
    const code = error instanceof Error ? error.message : "workout_plan_context_unavailable";
    const statusByCode: Record<string, 409 | 422 | 503> = {
      profile_or_accepted_goal_required: 409,
      workout_planning_not_available_for_this_profile: 422,
      workout_movement_review_required: 422,
      workout_days_required: 422,
      workout_exercise_coverage_insufficient: 422,
    };
    return c.json({ error: statusByCode[code] ? code : "workout_plan_context_unavailable" }, statusByCode[code] ?? 503);
  }
  const inputHash = hashWorkoutPlanningContext(planning.context);
  const runId = randomUUID();
  const runSetup = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    await lockAiUsageWindow(tx, userId);
    const [prior] = await tx.select().from(aiRuns).where(and(
      eq(aiRuns.userId, userId), eq(aiRuns.kind, "workout_plan"), eq(aiRuns.idempotencyKey, parsed.data.idempotencyKey),
    )).limit(1);
    if (prior) {
      if (prior.inputHash !== inputHash) return { status: "idempotency_conflict" as const };
      const [plan] = prior.resultPlanId ? await tx.select().from(plans).where(and(
        eq(plans.userId, userId), eq(plans.id, prior.resultPlanId), eq(plans.kind, "workout"),
      )).limit(1) : [];
      return { status: "existing" as const, run: prior, plan };
    }
    const [active] = await tx.select().from(plans).where(and(
      eq(plans.userId, userId), eq(plans.kind, "workout"), eq(plans.status, "active"),
    )).orderBy(desc(plans.version)).limit(1);
    const [draft] = await tx.select({ id: plans.id }).from(plans).where(and(
      eq(plans.userId, userId), eq(plans.kind, "workout"), eq(plans.status, "draft"),
    )).limit(1);
    if (draft) return { status: "draft_conflict" as const, planId: draft.id };
    if (!(await hasAiOperationCapacity(tx, userId))) return { status: "quota_exceeded" as const };
    const groupId = active?.groupId ?? runId;
    const [latest] = await tx.select({ version: plans.version }).from(plans).where(and(
      eq(plans.userId, userId), eq(plans.groupId, groupId), eq(plans.kind, "workout"),
    )).orderBy(desc(plans.version)).limit(1);
    const [created] = await tx.insert(aiRuns).values({
      id: runId,
      userId,
      kind: "workout_plan",
      status: "running",
      idempotencyKey: parsed.data.idempotencyKey,
      inputHash,
      inputSnapshot: { ...planning.context },
      model: workoutPlanningVersions.model,
      promptVersion: workoutPlanningVersions.prompt,
      schemaVersion: workoutPlanningVersions.schema,
    }).onConflictDoNothing().returning();
    if (!created) return { status: "idempotency_race" as const };
    return { status: "created" as const, groupId, planVersion: (latest?.version ?? 0) + 1 };
  });
  if (runSetup.status === "draft_conflict") return c.json({ error: "workout_plan_draft_exists", planId: runSetup.planId }, 409);
  if (runSetup.status === "quota_exceeded") return c.json({ error: "ai_daily_limit_reached" }, 429);
  if (runSetup.status === "idempotency_conflict") return c.json({ error: "idempotency_key_reused_with_different_input" }, 409);
  if (runSetup.status === "idempotency_race") return c.json({ error: "workout_plan_run_in_progress" }, 409);
  if (runSetup.status === "existing") {
    return c.json({
      runId: runSetup.run.id,
      status: runSetup.run.status,
      plan: runSetup.plan ? workoutPlanResponse(runSetup.plan) : null,
      errorCode: runSetup.run.errorCode,
    });
  }

  try {
    const result = await runWorkoutPlan({
      userId,
      runId,
      idempotencyKey: parsed.data.idempotencyKey,
      groupId: runSetup.groupId,
      planVersion: runSetup.planVersion,
      inputHash,
      context: planning.context,
      candidates: planning.candidates,
    });
    const [planRow] = result.planId ? await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return tx.select().from(plans).where(and(
        eq(plans.userId, userId), eq(plans.id, result.planId!), eq(plans.kind, "workout"),
      )).limit(1);
    }) : [];
    const plan = planRow ? workoutPlanResponse(planRow) : null;
    if (result.terminalStatus === "failed") return c.json({ runId, status: "failed", plan: null }, 422);
    return c.json({ runId, status: "pending_review", plan }, 201);
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith("gemini_http_")
      ? "workout_plan_provider_unavailable"
      : error instanceof Error && error.message === "gemini_not_configured"
        ? "workout_planning_not_configured"
        : "workout_plan_generation_failed";
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      await tx.update(aiRuns).set({ status: "failed", errorCode: code, updatedAt: new Date() })
        .where(and(eq(aiRuns.userId, userId), eq(aiRuns.id, runId), eq(aiRuns.status, "running")));
    });
    return c.json({ runId, status: "failed", error: code }, 502);
  }
});

app.get("/v1/exercises/:exerciseId/progress", async (c) => {
  const exerciseId = c.req.param("exerciseId");
  const exercise = findExerciseById(exerciseId);
  if (!exercise) return c.json({ error: "exercise_not_found" }, 404);
  const parsedQuery = exerciseProgressQuerySchema.safeParse(c.req.query());
  if (!parsedQuery.success) return c.json({ error: "invalid_exercise_progress_range" }, 400);
  const rangeDays = parsedQuery.data.range === "30d" ? 30 : parsedQuery.data.range === "90d" ? 90 : 365;
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [profile] = await tx.select({ data: userProfiles.data }).from(userProfiles)
      .where(eq(userProfiles.userId, userId)).limit(1);
    const savedProfile = profileSchema.safeParse(profile?.data);
    const records = await tx.select({ data: userRecords.data }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "activity_log"),
      eq(userRecords.deleted, false),
    ));
    return { timezone: savedProfile.success ? savedProfile.data.timezone : "UTC", records };
  });
  let timezone = result.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    timezone = "UTC";
  }
  const rangeEnd = localDateInZone(new Date().toISOString(), timezone);
  const rangeStart = shiftLocalDate(rangeEnd, 1 - rangeDays);
  const pointsByDate = new Map<string, {
    date: string;
    sessions: number;
    setCount: number;
    bestSetReps: number | null;
    bestLoadKg: number | null;
    longestHoldSeconds: number | null;
  }>();
  for (const record of result.records) {
    const parsed = activityLogRecordSchema.safeParse(record.data);
    if (!parsed.success || parsed.data.activityType !== "strength" || !parsed.data.exercises?.length) continue;
    const matchingExercises = parsed.data.exercises.filter((item) => item.exerciseId === exerciseId);
    if (!matchingExercises.length) continue;
    const date = localDateInZone(parsed.data.occurredAt, timezone);
    if (date < rangeStart || date > rangeEnd) continue;
    const point = pointsByDate.get(date) ?? {
      date,
      sessions: 0,
      setCount: 0,
      bestSetReps: null,
      bestLoadKg: null,
      longestHoldSeconds: null,
    };
    point.sessions += 1;
    for (const matchingExercise of matchingExercises) {
      point.setCount += matchingExercise.sets.length;
      for (const set of matchingExercise.sets) {
        if (set.reps !== null && set.reps !== undefined) {
          point.bestSetReps = Math.max(point.bestSetReps ?? 0, set.reps);
        }
        if (set.loadKg !== null) {
          point.bestLoadKg = Math.max(point.bestLoadKg ?? 0, set.loadKg);
        }
        if (set.durationSeconds !== null && set.durationSeconds !== undefined) {
          point.longestHoldSeconds = Math.max(point.longestHoldSeconds ?? 0, set.durationSeconds);
        }
      }
    }
    pointsByDate.set(date, point);
  }
  return c.json({
    exercise: { id: exercise.id, name: exercise.name, trackingMode: exercise.trackingMode },
    timezone,
    rangeStart,
    rangeEnd,
    points: [...pointsByDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
  });
});

app.post("/v1/goals/proposal", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsedRequest = goalProposalRequestSchema.safeParse(body);
  if (!parsedRequest.success) return c.json({ error: "invalid_goal_request" }, 400);

  const userId = c.get("session").user.id;
  const profile = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [saved] = await tx.select({ data: userProfiles.data })
      .from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    return saved?.data ?? null;
  });
  const parsedProfile = profileSchema.safeParse(profile);
  if (!parsedProfile.success) return c.json({ error: "profile_required" }, 409);

  const proposal = buildGoalProposal(parsedProfile.data, parsedRequest.data);
  if (proposal.status === "invalid") return c.json({ error: "invalid_goal", message: proposal.reason }, 422);
  return c.json(proposal);
});

app.get("/v1/goals", async (c) => {
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const goals = await tx.select({ id: userRecords.recordId, data: userRecords.data })
      .from(userRecords).where(and(
        eq(userRecords.userId, userId),
        eq(userRecords.entity, "goal"),
        eq(userRecords.deleted, false),
      ));
    const measurements = await tx.select({ id: userRecords.recordId, data: userRecords.data })
      .from(userRecords).where(and(
        eq(userRecords.userId, userId),
        eq(userRecords.entity, "body_measurement"),
        eq(userRecords.deleted, false),
      ));
    return { goals, measurements };
  });

  const versions = result.goals.flatMap((record) => {
    const parsed = goalSchema.safeParse(record.data);
    return parsed.success ? [{ id: record.id, ...parsed.data }] : [];
  }).sort((left, right) => right.goalVersion - left.goalVersion);
  return c.json({ current: versions[0] ?? null, versions, measurements: result.measurements });
});

app.post("/v1/goals/accept", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = acceptGoalRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_goal_acceptance" }, 400);

  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

    const [existing] = await tx.select({ id: userRecords.recordId, data: userRecords.data })
      .from(userRecords).where(and(
        eq(userRecords.userId, userId),
        eq(userRecords.entity, "goal"),
        eq(userRecords.recordId, parsed.data.goalId),
        eq(userRecords.deleted, false),
      )).limit(1);
    if (existing) {
      const priorGoal = goalSchema.safeParse(existing.data);
      if (priorGoal.success) return { status: "accepted" as const, goal: { id: existing.id, ...priorGoal.data }, idempotent: true };
      return { status: "conflict" as const };
    }

    const [savedProfile] = await tx.select({ data: userProfiles.data })
      .from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    const profile = profileSchema.safeParse(savedProfile?.data);
    if (!profile.success) return { status: "profile_required" as const };

    const proposal = buildGoalProposal(profile.data, parsed.data.request);
    if (proposal.status === "manual_required") {
      return { status: "manual_required" as const, reasonCode: proposal.reasonCode, reasons: proposal.reasons };
    }
    if (proposal.status === "invalid") return { status: "invalid" as const, message: proposal.reason };

    const existingGoals = await tx.select({ data: userRecords.data }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "goal"),
      eq(userRecords.deleted, false),
    ));
    const previousVersions = existingGoals.flatMap((record) => {
      const candidate = goalSchema.safeParse(record.data);
      return candidate.success ? [candidate.data.goalVersion] : [];
    });
    const goal = goalSchema.parse({
      ...proposal.goal,
      goalVersion: Math.max(0, ...previousVersions) + 1,
      acceptedAt: new Date().toISOString(),
    });

    const measurementData = {
      measuredAt: new Date().toISOString(),
      weightKg: profile.data.currentWeightKg,
    };
    const [existingMeasurement] = await tx.select({ data: userRecords.data })
      .from(userRecords).where(and(
        eq(userRecords.userId, userId),
        eq(userRecords.entity, "body_measurement"),
        eq(userRecords.recordId, parsed.data.measurementId),
      )).limit(1);
    if (existingMeasurement && JSON.stringify(existingMeasurement.data) !== JSON.stringify(measurementData)) {
      return { status: "conflict" as const };
    }

    await tx.insert(userSyncCounters).values({ userId, cursor: 0 }).onConflictDoNothing();
    const records = [
      { entity: "goal" as const, recordId: parsed.data.goalId, data: goal },
      { entity: "body_measurement" as const, recordId: parsed.data.measurementId, data: measurementData },
    ];
    for (const record of records) {
      if (record.entity === "body_measurement" && existingMeasurement) continue;
      await tx.insert(userRecords).values({
        userId,
        entity: record.entity,
        recordId: record.recordId,
        version: 1,
        data: record.data,
        deleted: false,
        serverUpdatedAt: new Date(),
      });
      const [counter] = await tx.update(userSyncCounters).set({
        cursor: sql`${userSyncCounters.cursor} + 1`,
      }).where(eq(userSyncCounters.userId, userId)).returning({ cursor: userSyncCounters.cursor });
      if (!counter) throw new Error("sync_cursor_update_failed");
      await tx.insert(syncChanges).values({
        userId,
        cursor: counter.cursor,
        entity: record.entity,
        recordId: record.recordId,
        version: 1,
        data: record.data,
        deleted: false,
      });
    }
    return { status: "accepted" as const, goal: { id: parsed.data.goalId, ...goal }, idempotent: false };
  });

  if (result.status === "profile_required") return c.json({ error: "profile_required" }, 409);
  if (result.status === "manual_required") return c.json({ error: "manual_target_required", reasonCode: result.reasonCode, reasons: result.reasons }, 422);
  if (result.status === "invalid") return c.json({ error: "invalid_goal", message: result.message }, 422);
  if (result.status === "conflict") return c.json({ error: "goal_id_conflict" }, 409);
  return c.json(result, result.idempotent ? 200 : 201);
});

app.post("/v1/measurements", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = createMeasurementRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_measurement" }, 400);
  const measuredAt = Date.parse(parsed.data.measuredAt);
  const now = Date.now();
  if (measuredAt > now + 5 * 60_000 || measuredAt < now - 10 * 366 * 86_400_000) {
    return c.json({ error: "measurement_date_out_of_range" }, 422);
  }

  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [existing] = await tx.select({ data: userRecords.data })
      .from(userRecords).where(and(
        eq(userRecords.userId, userId),
        eq(userRecords.entity, "body_measurement"),
        eq(userRecords.recordId, parsed.data.measurementId),
      )).limit(1);
    if (existing) return { idempotent: true };

    await tx.insert(userSyncCounters).values({ userId, cursor: 0 }).onConflictDoNothing();
    const data = { measuredAt: parsed.data.measuredAt, weightKg: parsed.data.weightKg };
    await tx.insert(userRecords).values({
      userId,
      entity: "body_measurement",
      recordId: parsed.data.measurementId,
      version: 1,
      data,
      deleted: false,
      serverUpdatedAt: new Date(),
    });
    const [counter] = await tx.update(userSyncCounters).set({
      cursor: sql`${userSyncCounters.cursor} + 1`,
    }).where(eq(userSyncCounters.userId, userId)).returning({ cursor: userSyncCounters.cursor });
    if (!counter) throw new Error("sync_cursor_update_failed");
    await tx.insert(syncChanges).values({
      userId,
      cursor: counter.cursor,
      entity: "body_measurement",
      recordId: parsed.data.measurementId,
      version: 1,
      data,
      deleted: false,
    });
    return { idempotent: false };
  });
  return c.json({ ...parsed.data, idempotent: result.idempotent }, result.idempotent ? 200 : 201);
});

app.post("/v1/sync/push", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const parsed = syncPushSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_sync_operations" }, 400);
  const userId = c.get("session").user.id;
  try {
    return c.json(await pushSync(userId, parsed.data));
  } catch (error) {
    if (error instanceof Error && error.message === "catalog_food_not_found") {
      return c.json({ error: "catalog_food_not_found" }, 422);
    }
    if (error instanceof Error && error.message === "invalid_exercise_reference") {
      return c.json({ error: "invalid_exercise_reference" }, 422);
    }
    if (error instanceof Error && error.message === "sync_request_in_progress") {
      return c.json({ error: "request_in_progress" }, 409);
    }
    if (error instanceof Error && error.message === "goal_changes_require_acceptance") {
      return c.json({ error: "goal_changes_require_acceptance" }, 422);
    }
    throw error;
  }
});

app.get("/v1/sync/pull", async (c) => {
  const params = Object.fromEntries(new URL(c.req.url).searchParams);
  const parsed = syncPullQuerySchema.safeParse(params);
  if (!parsed.success) return c.json({ error: "invalid_sync_cursor" }, 400);
  const userId = c.get("session").user.id;
  return c.json(await pullSync(userId, parsed.data.cursor, parsed.data.limit));
});

app.get("/v1/private-uploads/:id", async (c) => {
  const userId = c.get("session").user.id;
  const uploadId = c.req.param("id");
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return c.json({ error: "not_found" }, 404);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [upload] = await tx.select({
      id: privateUploads.id,
      contentType: privateUploads.contentType,
      byteSize: privateUploads.byteSize,
      expiresAt: privateUploads.expiresAt,
    }).from(privateUploads).where(and(
      eq(privateUploads.userId, userId),
      eq(privateUploads.id, uploadId),
    )).limit(1);
    return upload ?? null;
  });
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json({ error: "private_storage_not_configured" }, 503);
});

function matchesSecret(candidate: string | undefined, expected: string | undefined): boolean {
  if (!candidate || !expected) return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes);
}

const requireJobSecret = createMiddleware<BackendEnv>(async (c, next) => {
  if (!matchesSecret(c.req.header("x-job-dispatch-secret"), env.JOB_DISPATCH_SECRET)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.use("/internal/jobs/*", requireJobSecret);

app.post("/internal/jobs/claim", async (c) => {
  let body: { workerId?: unknown; limit?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const workerId = typeof body.workerId === "string" ? body.workerId.trim() : "";
  const limit = typeof body.limit === "number" ? Math.floor(body.limit) : 0;
  if (workerId.length < 1 || workerId.length > 80 || limit < 1 || limit > 20) {
    return c.json({ error: "invalid_job_claim" }, 400);
  }
  return c.json({ jobs: await claimJobs(workerId, limit) });
});

app.post("/internal/jobs/:id/complete", async (c) => {
  const workerId = c.req.header("x-worker-id") ?? "";
  const updated = await completeJob(c.req.param("id"), workerId);
  return c.json({ updated }, updated ? 200 : 409);
});

app.post("/internal/jobs/:id/fail", async (c) => {
  const workerId = c.req.header("x-worker-id") ?? "";
  let body: { errorCode?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  const errorCode = typeof body.errorCode === "string" ? body.errorCode : "worker_failed";
  const updated = await failJob(c.req.param("id"), workerId, errorCode);
  return c.json({ updated }, updated ? 200 : 409);
});

app.onError((_error, c) => {
  console.error(`Request failed (${c.req.method} ${c.req.path}).`);
  return c.json({ error: "internal_server_error" }, 500);
});

export { app };
export type AppType = typeof app;
