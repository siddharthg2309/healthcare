import { timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { cors } from "hono/cors";
import { db } from "@healthcare/database";
import { catalogFoods, foodDayStatuses, privateUploads, syncChanges, userFoods, userProfiles, userRecords, userSyncCounters } from "@healthcare/database/schema";
import {
  activityLogRecordSchema,
  acceptGoalRequestSchema,
  createActivityLogRequestSchema,
  createCustomFoodRequestSchema,
  createFoodLogRequestSchema,
  createMeasurementRequestSchema,
  deleteActivityLogRequestSchema,
  deleteFoodLogRequestSchema,
  exerciseProgressQuerySchema,
  foodDayStatusRequestSchema,
  foodLogRecordSchema,
  goalProposalRequestSchema,
  goalSchema,
  profileSchema,
  syncPullQuerySchema,
  syncPushSchema,
  updateActivityLogRequestSchema,
  updateFoodLogRequestSchema,
} from "@healthcare/contracts";
import { buildGoalProposal, findExerciseById } from "@healthcare/domain";
import { auth } from "./auth/config.js";
import { env, isAllowedWebOrigin } from "./env.js";
import { redeemInvitation, releaseInvitation, reserveInvitation } from "./auth/invitations.js";
import { claimJobs, completeJob, failJob } from "./services/jobs.js";
import { pullSync, pushSync } from "./services/sync.js";

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

const requireSession = createMiddleware<BackendEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("session", session);
  await next();
});

app.use("/v1/*", requireSession);

function nutritionValue(value: string | number): number {
  return Number(value);
}

function roundNutrition(value: number): number {
  return Math.round(value * 100) / 100;
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

function shiftLocalDate(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

app.get("/v1/foods", async (c) => {
  const query = new URL(c.req.url).searchParams.get("query")?.trim() ?? "";
  if (query.length > 80) return c.json({ error: "search_query_too_long" }, 400);
  const userId = c.get("session").user.id;
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const shared = await tx.select().from(catalogFoods).where(and(
      eq(catalogFoods.active, true),
      ilike(catalogFoods.name, pattern),
    )).orderBy(desc(catalogFoods.reviewed), asc(catalogFoods.name)).limit(30);
    const personal = await tx.select().from(userFoods).where(ilike(userFoods.name, pattern))
      .orderBy(asc(userFoods.name)).limit(20);
    return { shared, personal };
  });
  const foods = [
    ...result.shared.map((food) => ({
      id: food.id,
      name: food.name,
      category: food.category,
      source: "shared_catalog" as const,
      sourceNote: food.source,
      reviewed: food.reviewed,
      caloriesKcalPer100g: nutritionValue(food.caloriesKcalPer100g),
      proteinGPer100g: nutritionValue(food.proteinGPer100g),
      carbohydrateGPer100g: nutritionValue(food.carbohydrateGPer100g),
      fatGPer100g: nutritionValue(food.fatGPer100g),
    })),
    ...result.personal.map((food) => ({
      id: food.id,
      name: food.name,
      category: food.category,
      source: "personal" as const,
      sourceNote: food.sourceNote,
      reviewed: false,
      caloriesKcalPer100g: nutritionValue(food.caloriesKcalPer100g),
      proteinGPer100g: nutritionValue(food.proteinGPer100g),
      carbohydrateGPer100g: nutritionValue(food.carbohydrateGPer100g),
      fatGPer100g: nutritionValue(food.fatGPer100g),
    })),
  ];
  return c.json({ foods });
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
      category: result.food.category,
      source: "personal",
      sourceNote: result.food.sourceNote,
      reviewed: false,
      caloriesKcalPer100g: nutritionValue(result.food.caloriesKcalPer100g),
      proteinGPer100g: nutritionValue(result.food.proteinGPer100g),
      carbohydrateGPer100g: nutritionValue(result.food.carbohydrateGPer100g),
      fatGPer100g: nutritionValue(result.food.fatGPer100g),
    },
    idempotent: result.idempotent,
  }, result.idempotent ? 200 : 201);
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
        && prior.data.quantityGrams === parsed.data.quantityGrams;
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
      category: food.category,
      occurredAt: parsed.data.occurredAt,
      mealType: parsed.data.mealType,
      quantityGrams: parsed.data.quantityGrams,
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
  if (result.status === "conflict") return c.json({ error: "food_log_id_conflict" }, 409);
  return c.json({ id: parsed.data.logId, version: result.version, data: result.data, idempotent: result.idempotent }, result.idempotent ? 200 : 201);
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
    const factor = quantityGrams / 100;
    const data = foodLogRecordSchema.parse({
      ...prior.data,
      occurredAt: parsed.data.occurredAt ?? prior.data.occurredAt,
      mealType: parsed.data.mealType ?? prior.data.mealType,
      quantityGrams,
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
  const invalidExerciseReference = parsed.data.exercises?.some((exercise) => {
    if (!exercise.exerciseId) return false;
    const catalogExercise = findExerciseById(exercise.exerciseId);
    return !catalogExercise || catalogExercise.name !== exercise.exerciseName;
  });
  if (invalidExerciseReference) return c.json({ error: "invalid_exercise_reference" }, 400);
  const data = activityLogRecordSchema.parse({
    activityType: parsed.data.activityType,
    occurredAt: parsed.data.occurredAt,
    durationMinutes: parsed.data.durationMinutes,
    steps: parsed.data.steps,
    notes: parsed.data.notes,
    ...(parsed.data.workoutTitle ? { workoutTitle: parsed.data.workoutTitle } : {}),
    ...(parsed.data.exercises ? { exercises: parsed.data.exercises } : {}),
  });
  const userId = c.get("session").user.id;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [existing] = await tx.select({ data: userRecords.data, version: userRecords.version }).from(userRecords).where(and(
      eq(userRecords.userId, userId),
      eq(userRecords.entity, "activity_log"),
      eq(userRecords.recordId, parsed.data.activityId),
      eq(userRecords.deleted, false),
    )).limit(1);
    if (existing) {
      const prior = activityLogRecordSchema.safeParse(existing.data);
      const same = prior.success && JSON.stringify(prior.data) === JSON.stringify(data);
      return { status: same ? "saved" as const : "conflict" as const, data: existing.data, version: existing.version, idempotent: same };
    }
    await tx.insert(userRecords).values({
      userId,
      entity: "activity_log",
      recordId: parsed.data.activityId,
      version: 1,
      data,
      deleted: false,
      serverUpdatedAt: new Date(),
    });
    await appendSyncChange(tx, userId, "activity_log", parsed.data.activityId, data);
    return { status: "saved" as const, data, version: 1, idempotent: false };
  });
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
  const invalidExerciseReference = parsed.data.exercises?.some((exercise) => {
    if (!exercise.exerciseId) return false;
    const catalogExercise = findExerciseById(exercise.exerciseId);
    return !catalogExercise || catalogExercise.name !== exercise.exerciseName;
  });
  if (invalidExerciseReference) return c.json({ error: "invalid_exercise_reference" }, 400);
  const data = activityLogRecordSchema.parse({
    activityType: parsed.data.activityType,
    occurredAt: parsed.data.occurredAt,
    durationMinutes: parsed.data.durationMinutes,
    steps: parsed.data.steps,
    notes: parsed.data.notes,
    ...(parsed.data.workoutTitle ? { workoutTitle: parsed.data.workoutTitle } : {}),
    ...(parsed.data.exercises ? { exercises: parsed.data.exercises } : {}),
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
    if (!activityLogRecordSchema.safeParse(existing.data).success) return { status: "invalid_record" as const };
    const version = existing.version + 1;
    const [saved] = await tx.update(userRecords).set({
      data,
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
    await appendSyncChange(tx, userId, "activity_log", recordId, data, version);
    return { status: "saved" as const, data: saved.data, version: saved.version };
  });
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
    const [status] = await tx.select({ complete: foodDayStatuses.complete }).from(foodDayStatuses).where(and(
      eq(foodDayStatuses.userId, userId),
      eq(foodDayStatuses.localDate, date),
    )).limit(1);
    return { timezone, foodRecords, activityRecords, foodDayComplete: status?.complete ?? false };
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
    return parsed.success && localDateInZone(parsed.data.occurredAt, timezone) === date
      ? [{ id: record.id, version: record.version, data: parsed.data }]
      : [];
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
  return c.json({ date, timezone, foodLogs, activityLogs, foodTotals, steps, workoutsCompleted, foodDayComplete: result.foodDayComplete });
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
      return { status: "manual_required" as const, reasons: proposal.reasons };
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
  if (result.status === "manual_required") return c.json({ error: "manual_target_required", reasons: result.reasons }, 422);
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
