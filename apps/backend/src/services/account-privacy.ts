import { eq, sql } from "drizzle-orm";
import { db, pool } from "@healthcare/database";
import {
  aiRuns,
  calendarEventLinks,
  foodDayStatuses,
  foodFavorites,
  googleCalendarConnections,
  plans,
  privateUploads,
  reminderPreferences,
  syncChanges,
  userFoods,
  userProfiles,
  userRecords,
} from "@healthcare/database/schema";
import { deleteMealPlanningCheckpoint } from "./meal-planning.js";
import { deleteWorkoutPlanningCheckpoint } from "./workout-planning.js";
import { decryptGoogleRefreshToken, revokeGoogleRefreshToken } from "./google-calendar.js";

const accountCascadeConstraints = [
  "user_foods_user_id_user_id_fk",
  "food_day_statuses_user_id_user_id_fk",
  "plans_user_id_user_id_fk",
  "ai_runs_user_id_user_id_fk",
  "ai_runs_result_plan_id_plans_id_fk",
  "invitations_redeemed_by_user_id_fk",
  "food_favorites_user_id_user_id_fk",
];
const accountPrivateTables = ["user_foods", "food_day_statuses", "plans", "ai_runs", "food_favorites"];

export async function assertAccountDeletionReady(): Promise<void> {
  const [constraints, protectedTables] = await Promise.all([
    pool.query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])",
      [accountCascadeConstraints],
    ),
    pool.query<{ relname: string }>(
      `SELECT relname FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relforcerowsecurity = true
         AND relname = ANY($1::text[])`,
      [accountPrivateTables],
    ),
  ]);
  if (constraints.rows.length !== accountCascadeConstraints.length || protectedTables.rows.length !== accountPrivateTables.length) {
    throw new Error("account_deletion_migration_required");
  }
}

export async function exportAccountData(userId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [profile] = await tx.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    const records = await tx.select().from(userRecords).where(eq(userRecords.userId, userId));
    const changes = await tx.select().from(syncChanges).where(eq(syncChanges.userId, userId));
    const personalFoods = await tx.select().from(userFoods).where(eq(userFoods.userId, userId));
    const favorites = await tx.select().from(foodFavorites).where(eq(foodFavorites.userId, userId));
    const dayStatuses = await tx.select().from(foodDayStatuses).where(eq(foodDayStatuses.userId, userId));
    const savedPlans = await tx.select().from(plans).where(eq(plans.userId, userId));
    const aiHistory = await tx.select().from(aiRuns).where(eq(aiRuns.userId, userId));
    const [reminders] = await tx.select().from(reminderPreferences)
      .where(eq(reminderPreferences.userId, userId)).limit(1);
    const [calendar] = await tx.select({ calendarName: googleCalendarConnections.calendarName, lastSyncedAt: googleCalendarConnections.lastSyncedAt })
      .from(googleCalendarConnections).where(eq(googleCalendarConnections.userId, userId)).limit(1);
    const eventLinks = await tx.select({ occurrenceDate: calendarEventLinks.occurrenceDate, planId: calendarEventLinks.planId, planVersion: calendarEventLinks.planVersion, googleEventId: calendarEventLinks.googleEventId, updatedAt: calendarEventLinks.updatedAt })
      .from(calendarEventLinks).where(eq(calendarEventLinks.userId, userId));
    const uploads = await tx.select({ id: privateUploads.id, contentType: privateUploads.contentType, byteSize: privateUploads.byteSize, expiresAt: privateUploads.expiresAt, createdAt: privateUploads.createdAt })
      .from(privateUploads).where(eq(privateUploads.userId, userId));

    return {
      format: "goal-health-export-v1",
      exportedAt: new Date().toISOString(),
      accountId: userId,
      profile: profile?.data ?? null,
      records: records.map((record) => ({
        entity: record.entity,
        id: record.recordId,
        version: record.version,
        data: record.data,
        deleted: record.deleted,
        updatedAt: record.serverUpdatedAt,
      })),
      changeHistory: changes.map((change) => ({
        cursor: change.cursor,
        entity: change.entity,
        id: change.recordId,
        version: change.version,
        data: change.data,
        deleted: change.deleted,
        createdAt: change.createdAt,
      })),
      personalFoods,
      foodFavorites: favorites,
      foodDayStatuses: dayStatuses,
      plans: savedPlans,
      aiPlanningHistory: aiHistory,
      reminderPreferences: reminders?.data ?? null,
      calendar: calendar ? { ...calendar, eventLinks } : null,
      temporaryUploadMetadata: uploads,
    };
  });
}

export async function cleanupBeforeAccountDeletion(userId: string): Promise<void> {
  await assertAccountDeletionReady();
  const data = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const runs = await tx.select({ id: aiRuns.id, kind: aiRuns.kind }).from(aiRuns)
      .where(eq(aiRuns.userId, userId));
    const [calendar] = await tx.select({ encryptedRefreshToken: googleCalendarConnections.encryptedRefreshToken })
      .from(googleCalendarConnections).where(eq(googleCalendarConnections.userId, userId)).limit(1);
    return { runs, calendar };
  });

  for (const run of data.runs) {
    if (run.kind === "meal_plan") await deleteMealPlanningCheckpoint(run.id);
    else if (run.kind === "workout_plan") await deleteWorkoutPlanningCheckpoint(run.id);
  }

  if (data.calendar) {
    try {
      const refreshToken = decryptGoogleRefreshToken(data.calendar.encryptedRefreshToken);
      await revokeGoogleRefreshToken(refreshToken);
    } catch {
      // Local credentials are removed by account cascades even if Google is unavailable.
    }
  }
}
