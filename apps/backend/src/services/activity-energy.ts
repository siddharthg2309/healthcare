import { and, eq } from "drizzle-orm";
import type { db } from "@healthcare/database";
import { userProfiles, userRecords } from "@healthcare/database/schema";
import { createMeasurementRequestSchema, profileSchema, type ActivityLogRecord } from "@healthcare/contracts";
import { estimateActivityEnergy, selectActivityWeight } from "@healthcare/domain";

type Reader = Pick<typeof db, "select">;
type EnergyInput = Pick<ActivityLogRecord, "activityType" | "occurredAt" | "durationMinutes" | "energyKind">;

export function createActivityEnergyEstimator(
  profileData: unknown,
  rows: ReadonlyArray<{ id: string; data: Record<string, unknown> | null }>,
) {
  const profile = profileSchema.safeParse(profileData);
  const measurements = rows.flatMap((row) => {
    const parsed = createMeasurementRequestSchema.safeParse({
      measurementId: row.id,
      measuredAt: row.data?.measuredAt,
      weightKg: row.data?.weightKg,
    });
    return parsed.success ? [parsed.data] : [];
  });
  return (input: EnergyInput, prior?: ActivityLogRecord) => {
    // Notes and set corrections keep the original weight snapshot and estimate.
    if (prior?.energyEstimate && prior.activityType === input.activityType && prior.occurredAt === input.occurredAt
      && prior.durationMinutes === input.durationMinutes && prior.energyKind === input.energyKind) return prior.energyEstimate;
    const weight = selectActivityWeight(measurements, profile.success ? profile.data.currentWeightKg : null, input.occurredAt);
    return estimateActivityEnergy({ ...input, weight });
  };
}

export async function buildActivityEnergyEstimate(reader: Reader, userId: string, input: EnergyInput, prior?: ActivityLogRecord) {
  if (prior?.energyEstimate && prior.activityType === input.activityType && prior.occurredAt === input.occurredAt
    && prior.durationMinutes === input.durationMinutes && prior.energyKind === input.energyKind) return prior.energyEstimate;
  if (!input.durationMinutes || input.activityType === "steps" || input.activityType === "other") return null;
  const [profileRow] = await reader.select({ data: userProfiles.data }).from(userProfiles)
    .where(eq(userProfiles.userId, userId)).limit(1);
  const rows = await reader.select({ id: userRecords.recordId, data: userRecords.data }).from(userRecords).where(and(
    eq(userRecords.userId, userId), eq(userRecords.entity, "body_measurement"), eq(userRecords.deleted, false),
  ));
  return createActivityEnergyEstimator(profileRow?.data, rows)(input, prior);
}
