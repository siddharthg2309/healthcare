import type { ActivityEnergyEstimate, ActivityEnergyKind, ActivityLogRecord } from "@healthcare/contracts";

// 2024 Adult Compendium: https://pacompendium.com/adult-compendium/
export const activityEnergyOptions: ReadonlyArray<{
  id: ActivityEnergyKind;
  activityType: "walk" | "cardio" | "strength";
  label: string;
  met: number;
  code: string;
}> = [
  { id: "walk_slow", activityType: "walk", label: "Slow walk", met: 2.8, code: "17152" },
  { id: "walk_moderate", activityType: "walk", label: "Moderate walk", met: 3.8, code: "17190" },
  { id: "walk_brisk", activityType: "walk", label: "Brisk walk", met: 4.8, code: "17200" },
  { id: "aerobics", activityType: "cardio", label: "General aerobics", met: 7.3, code: "02000" },
  { id: "jogging", activityType: "cardio", label: "Jogging", met: 7.5, code: "12020" },
  { id: "stationary_cycle", activityType: "cardio", label: "Stationary bike", met: 6.8, code: "01200" },
  { id: "elliptical", activityType: "cardio", label: "Elliptical · moderate", met: 5, code: "02048" },
  { id: "rowing", activityType: "cardio", label: "Rowing · moderate", met: 5, code: "02071" },
  { id: "strength_general", activityType: "strength", label: "Weights · general", met: 3.5, code: "02054" },
  { id: "strength_vigorous", activityType: "strength", label: "Weights · vigorous", met: 6, code: "02050" },
  { id: "bodyweight", activityType: "strength", label: "Bodyweight · general", met: 3, code: "02056" },
];

export function defaultActivityEnergyKind(activityType: string): ActivityEnergyKind | undefined {
  if (activityType === "walk") return "walk_moderate";
  if (activityType === "cardio") return "aerobics";
  if (activityType === "strength") return "strength_general";
  return undefined;
}

export function isActivityEnergyKindAllowed(activityType: string, kind?: ActivityEnergyKind): boolean {
  return kind === undefined || activityEnergyOptions.some((option) => option.id === kind && option.activityType === activityType);
}

export function selectActivityWeight(
  measurements: ReadonlyArray<{ measuredAt: string; weightKg: number }>,
  profileWeightKg: number | null,
  occurredAt: string,
): Pick<ActivityEnergyEstimate, "weightKg" | "weightSource" | "weightMeasuredAt"> | null {
  const time = Date.parse(occurredAt);
  if (!Number.isFinite(time)) return null;
  const latest = measurements.filter((measurement) =>
    Number.isFinite(measurement.weightKg) && measurement.weightKg >= 25 && measurement.weightKg <= 400
    && Number.isFinite(Date.parse(measurement.measuredAt)) && Date.parse(measurement.measuredAt) <= time,
  ).sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt))[0];
  if (latest) return { weightKg: latest.weightKg, weightSource: "measurement", weightMeasuredAt: latest.measuredAt };
  if (profileWeightKg === null || !Number.isFinite(profileWeightKg) || profileWeightKg < 25 || profileWeightKg > 400) return null;
  return { weightKg: profileWeightKg, weightSource: "profile", weightMeasuredAt: null };
}

export function estimateActivityEnergy(input: {
  activityType: string;
  energyKind?: ActivityEnergyKind;
  durationMinutes: number | null;
  weight: ReturnType<typeof selectActivityWeight>;
}): ActivityEnergyEstimate | null {
  const kind = input.energyKind ?? defaultActivityEnergyKind(input.activityType);
  const option = activityEnergyOptions.find((entry) => entry.id === kind && entry.activityType === input.activityType);
  if (!option || !input.weight || input.durationMinutes === null || !Number.isInteger(input.durationMinutes)
    || input.durationMinutes < 1 || input.durationMinutes > 1440) return null;
  // Net active energy above rest; do not add it to the accepted food allowance.
  const caloriesKcal = Math.round((option.met - 1) * 3.5 * input.weight.weightKg / 200 * input.durationMinutes);
  return {
    method: "compendium_2024_net_v1",
    caloriesKcal,
    met: option.met,
    compendiumCode: option.code,
    weightKg: input.weight.weightKg,
    weightSource: input.weight.weightSource,
    weightMeasuredAt: input.weight.weightMeasuredAt,
  };
}

/** Daily activity burn is separate from food intake and resting expenditure. */
export function summarizeActivityEnergy(records: ReadonlyArray<Pick<ActivityLogRecord, "activityType" | "energyEstimate">>) {
  const sessions = records.filter((record) => ["walk", "cardio", "strength"].includes(record.activityType));
  const estimates = sessions.flatMap((record) => record.energyEstimate ? [record.energyEstimate] : []);
  return {
    caloriesKcal: estimates.length ? estimates.reduce((sum, estimate) => sum + estimate.caloriesKcal, 0) : sessions.length ? null : 0,
    estimatedSessions: estimates.length,
    sessionsMissingEstimate: sessions.length - estimates.length,
  };
}
