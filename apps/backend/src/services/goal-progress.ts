import { and, eq, sql } from "drizzle-orm";
import { db } from "@healthcare/database";
import { foodDayStatuses, userProfiles, userRecords } from "@healthcare/database/schema";
import { activityLogRecordSchema, createMeasurementRequestSchema, foodLogRecordSchema, goalSchema, profileSchema, progressOverviewResponseSchema, type Profile } from "@healthcare/contracts";
import { buildProgressOverview, getLocalDate } from "@healthcare/domain";
import { createActivityEnergyEstimator } from "./activity-energy.js";

export async function withLatestGoalWeight(reader: Pick<typeof db, "select">, userId: string, profile: Profile): Promise<Profile> {
  const rows = await reader.select({ id: userRecords.recordId, data: userRecords.data }).from(userRecords).where(and(
    eq(userRecords.userId, userId), eq(userRecords.entity, "body_measurement"), eq(userRecords.deleted, false),
  ));
  const measurements = rows.flatMap((row) => {
    const value = createMeasurementRequestSchema.safeParse({ measurementId: row.id, ...row.data });
    return value.success && Date.parse(value.data.measuredAt) <= Date.now() ? [value.data] : [];
  }).sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt));
  const latest = measurements[0];
  if (!latest) return profile;
  const date = getLocalDate(new Date(latest.measuredAt), profile.timezone);
  const values = measurements.filter((point) => getLocalDate(new Date(point.measuredAt), profile.timezone) === date).map((point) => point.weightKg).sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  const weight = values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
  return { ...profile, currentWeightKg: weight };
}

export async function readProgressOverview(userId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    const [profileRow] = await tx.select({ data: userProfiles.data }).from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1);
    const profile = profileSchema.safeParse(profileRow?.data);
    if (!profile.success) return null;
    const rows = await tx.select({ id: userRecords.recordId, entity: userRecords.entity, data: userRecords.data }).from(userRecords).where(and(
      eq(userRecords.userId, userId), eq(userRecords.deleted, false),
      sql`${userRecords.entity} in ('goal', 'food_log', 'activity_log', 'body_measurement')`,
    ));
    const statuses = await tx.select({ localDate: foodDayStatuses.localDate, complete: foodDayStatuses.complete }).from(foodDayStatuses).where(eq(foodDayStatuses.userId, userId));
    const measurementRows = rows.filter((row) => row.entity === "body_measurement");
    const estimateEnergy = createActivityEnergyEstimator(profile.data, measurementRows);
    const goals = rows.filter((row) => row.entity === "goal").flatMap((row) => { const value = goalSchema.safeParse(row.data); return value.success ? [value.data] : []; });
    const foods = rows.filter((row) => row.entity === "food_log").flatMap((row) => { const value = foodLogRecordSchema.safeParse(row.data); return value.success ? [value.data] : []; });
    const activities = rows.filter((row) => row.entity === "activity_log").flatMap((row) => {
      const value = activityLogRecordSchema.safeParse(row.data);
      return value.success ? [{ ...value.data, energyEstimate: value.data.energyEstimate ?? estimateEnergy(value.data) }] : [];
    });
    const measurements = measurementRows.flatMap((row) => { const value = createMeasurementRequestSchema.safeParse({ measurementId: row.id, ...row.data }); return value.success ? [value.data] : []; });
    const overview = buildProgressOverview({ goals, foods, activities, measurements, foodStatuses: statuses, timezone: profile.data.timezone, today: getLocalDate(new Date(), profile.data.timezone) });
    if (!overview) return null;
    const heightM = profile.data.heightCm / 100;
    const currentGoal = [...goals].sort((a, b) => b.goalVersion - a.goalVersion)[0];
    if (profile.data.ageYears < 19 || profile.data.ageYears > 78 || profile.data.pregnancyOrBreastfeeding || profile.data.clinicianDirectedDiet
      || overview.currentWeightKg / heightM ** 2 < 18.5 || (currentGoal && currentGoal.targetWeightKg / heightM ** 2 < 18.5)) {
      overview.forecast = { ...overview.forecast, status: "outside_range", arrivalDate: null, earliestDate: null, latestDate: null, points: [], message: "An automatic arrival forecast is unavailable for this profile. You can follow recorded weights and a clinician-guided plan." };
      overview.weekly.message = "Use this review to follow your recorded intake and activity alongside your clinician-guided target. Automatic arrival forecasting is unavailable for this profile.";
    }
    return progressOverviewResponseSchema.parse(overview);
  });
}
