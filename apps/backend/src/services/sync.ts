import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@healthcare/database";
import {
  catalogFoods,
  syncChanges,
  syncRequests,
  userRecords,
  userSyncCounters,
} from "@healthcare/database/schema";
import { activityLogRecordSchema, type SyncOperation, type SyncPushRequest } from "@healthcare/contracts";
import { findExerciseById, isActivityEnergyKindAllowed } from "@healthcare/domain";
import { hasOwnedCardioReport } from "./cardio-photo.js";
import { buildActivityEnergyEstimate } from "./activity-energy.js";

type SyncResult =
  | { status: "applied"; entity: string; id: string; version: number; cursor: number }
  | { status: "conflict"; entity: string; id: string; serverVersion: number; serverData: Record<string, unknown> | null; deleted: boolean }
  | { status: "already_missing"; entity: string; id: string };

export interface SyncPushResponse {
  results: SyncResult[];
  cursor: number;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

type DbReader = Pick<typeof db, "select" | "execute">;

async function normalizeOperation(
  operation: SyncOperation,
  reader: DbReader,
  userId: string,
  priorData: unknown,
): Promise<Record<string, unknown> | null> {
  if (operation.operation === "delete") return null;

  switch (operation.entity) {
    case "food_log": {
      const [food] = await reader.select().from(catalogFoods).where(
        and(eq(catalogFoods.id, operation.data.catalogFoodId), eq(catalogFoods.active, true)),
      ).limit(1);
      if (!food) throw new Error("catalog_food_not_found");

      const factor = operation.data.quantityGrams / 100;
      return {
        ...operation.data,
        foodNameSnapshot: food.name,
        nutritionSnapshot: {
          caloriesKcal: rounded(Number(food.caloriesKcalPer100g) * factor),
          proteinG: rounded(Number(food.proteinGPer100g) * factor),
          carbohydrateG: rounded(Number(food.carbohydrateGPer100g) * factor),
          fatG: rounded(Number(food.fatGPer100g) * factor),
          catalogFoodId: food.id,
          catalogSource: food.source,
        },
      };
    }
    case "activity_log": {
      if (!isActivityEnergyKindAllowed(operation.data.activityType, operation.data.energyKind)) throw new Error("invalid_activity_energy_kind");
      const invalidExerciseReference = operation.data.exercises?.some((exercise) => {
        if (!exercise.exerciseId) return false;
        const catalogExercise = findExerciseById(exercise.exerciseId);
        return !catalogExercise || catalogExercise.name !== exercise.exerciseName;
      });
      if (invalidExerciseReference) throw new Error("invalid_exercise_reference");
      const prior = activityLogRecordSchema.safeParse(priorData);
      // Older sync clients cannot silently discard a reviewed screenshot.
      if (prior.success && prior.data.cardioReport && !operation.data.cardioReport) throw new Error("cardio_report_requires_activity_editor");
      if (!await hasOwnedCardioReport(reader, userId, operation.id, operation.data)) throw new Error("cardio_report_unavailable");
      const energyEstimate = await buildActivityEnergyEstimate(reader, userId, operation.data, prior.success ? prior.data : undefined);
      return { ...operation.data, energyEstimate };
    }
    case "body_measurement":
      return operation.data;
    case "goal":
      return operation.data;
    default:
      throw new Error("unsupported_sync_entity");
  }
}

export async function pushSync(userId: string, request: SyncPushRequest): Promise<SyncPushResponse> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);

    const [insertedRequest] = await tx.insert(syncRequests).values({
      userId,
      idempotencyKey: request.idempotencyKey,
      response: null,
    }).onConflictDoNothing().returning({ idempotencyKey: syncRequests.idempotencyKey });

    if (!insertedRequest) {
      const [cached] = await tx.select({ response: syncRequests.response }).from(syncRequests).where(
        and(eq(syncRequests.userId, userId), eq(syncRequests.idempotencyKey, request.idempotencyKey)),
      ).limit(1);
      if (!cached?.response) throw new Error("sync_request_in_progress");
      return cached.response as unknown as SyncPushResponse;
    }

    await tx.insert(userSyncCounters).values({ userId, cursor: 0 }).onConflictDoNothing();
    const results: SyncResult[] = [];

    for (const operation of request.operations) {
      if (operation.entity === "goal") {
        throw new Error("goal_changes_require_acceptance");
      }

      const [current] = await tx.select().from(userRecords).where(and(
        eq(userRecords.userId, userId),
        eq(userRecords.entity, operation.entity),
        eq(userRecords.recordId, operation.id),
      )).limit(1);

      if (operation.operation === "delete" && !current) {
        results.push({ status: "already_missing", entity: operation.entity, id: operation.id });
        continue;
      }

      if (current && current.version !== operation.baseVersion) {
        results.push({
          status: "conflict",
          entity: operation.entity,
          id: operation.id,
          serverVersion: current.version,
          serverData: current.data,
          deleted: current.deleted,
        });
        continue;
      }

      if (!current && operation.operation === "upsert" && operation.baseVersion !== null && operation.baseVersion !== 0) {
        results.push({
          status: "conflict",
          entity: operation.entity,
          id: operation.id,
          serverVersion: 0,
          serverData: null,
          deleted: false,
        });
        continue;
      }

      const normalizedData = await normalizeOperation(operation, tx, userId, current?.data);
      const nextVersion = (current?.version ?? 0) + 1;
      const isDeleted = operation.operation === "delete";
      const [updated] = await tx.insert(userRecords).values({
        userId,
        entity: operation.entity,
        recordId: operation.id,
        version: nextVersion,
        data: normalizedData,
        deleted: isDeleted,
        clientUpdatedAt: null,
        serverUpdatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [userRecords.userId, userRecords.entity, userRecords.recordId],
        set: {
          version: nextVersion,
          data: normalizedData,
          deleted: isDeleted,
          serverUpdatedAt: new Date(),
        },
      }).returning({ version: userRecords.version, data: userRecords.data, deleted: userRecords.deleted });
      if (!updated) throw new Error("sync_record_write_failed");

      const [counter] = await tx.update(userSyncCounters).set({
        cursor: sql`${userSyncCounters.cursor} + 1`,
      }).where(eq(userSyncCounters.userId, userId)).returning({ cursor: userSyncCounters.cursor });
      if (!counter) throw new Error("sync_cursor_update_failed");

      await tx.insert(syncChanges).values({
        userId,
        cursor: counter.cursor,
        entity: operation.entity,
        recordId: operation.id,
        version: updated.version,
        data: updated.data,
        deleted: updated.deleted,
      });

      results.push({
        status: "applied",
        entity: operation.entity,
        id: operation.id,
        version: updated.version,
        cursor: counter.cursor,
      });
    }

    const [counter] = await tx.select({ cursor: userSyncCounters.cursor }).from(userSyncCounters)
      .where(eq(userSyncCounters.userId, userId)).limit(1);
    const response: SyncPushResponse = { results, cursor: counter?.cursor ?? 0 };

    await tx.update(syncRequests).set({ response: response as unknown as Record<string, unknown> }).where(and(
      eq(syncRequests.userId, userId),
      eq(syncRequests.idempotencyKey, request.idempotencyKey),
    ));

    return response;
  });
}

export async function pullSync(userId: string, cursor: number, limit: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const changes = await tx.select().from(syncChanges).where(and(
      eq(syncChanges.userId, userId),
      gt(syncChanges.cursor, cursor),
    )).orderBy(asc(syncChanges.cursor)).limit(limit);
    const nextCursor = changes.at(-1)?.cursor ?? cursor;
    return { changes, nextCursor, hasMore: changes.length === limit };
  });
}
