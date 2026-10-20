import { timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { cors } from "hono/cors";
import { db } from "@healthcare/database";
import { privateUploads, syncChanges, userProfiles, userRecords, userSyncCounters } from "@healthcare/database/schema";
import {
  acceptGoalRequestSchema,
  createMeasurementRequestSchema,
  goalProposalRequestSchema,
  goalSchema,
  profileSchema,
  syncPullQuerySchema,
  syncPushSchema,
} from "@healthcare/contracts";
import { buildGoalProposal } from "@healthcare/domain";
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
