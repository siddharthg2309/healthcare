import type { GoalRecord, Profile } from "@healthcare/contracts";

// Hall et al., Lancet 2011 population approximation: ~10 kcal/day/lb eventual
// change and a ~one-year half-time. Not the full NIH Body Weight Planner model.
export const GOAL_ENERGY_MODEL = "hall_reduced_v1" as const;
export const WEIGHT_ENERGY_FEEDBACK = 22;
export const WEIGHT_RESPONSE_DAYS = 365 / Math.log(2);
export const REFERENCE_KCAL_PER_KG = 7700; // Arithmetic reference, never the forecast.
export const activityMultipliers: Record<Profile["activityLevel"], number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
};
export const roundEnergy = (value: number) => Math.round(value);
export const roundWeight = (value: number) => Math.round(value * 100) / 100;
export function shiftGoalDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + Math.round(days) * 86400000).toISOString().slice(0, 10);
}
export function goalDaySpan(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}
export function restingEnergy(profile: Profile, weightKg = profile.currentWeightKg): number | null {
  if (profile.ageYears < 19 || profile.ageYears > 78 || profile.pregnancyOrBreastfeeding || profile.clinicianDirectedDiet) return null;
  const offset = profile.energyEquation === "mifflin_female" ? -161 : profile.energyEquation === "mifflin_male" ? 5 : null;
  return offset === null ? null : 10 * weightKg + 6.25 * profile.heightCm - 5 * profile.ageYears + offset;
}
export function scenarioWeightChange(initialDeficitKcal: number, days: number): number {
  return -initialDeficitKcal / WEIGHT_ENERGY_FEEDBACK * -Math.expm1(-Math.max(0, days) / WEIGHT_RESPONSE_DAYS);
}
export function deficitForChange(changeKg: number, days: number): number {
  return -changeKg * WEIGHT_ENERGY_FEEDBACK / -Math.expm1(-days / WEIGHT_RESPONSE_DAYS);
}
export function daysForChange(changeKg: number, initialDeficitKcal: number): number | null {
  if (Math.abs(changeKg) < 0.05) return 0;
  const fraction = -changeKg * WEIGHT_ENERGY_FEEDBACK / initialDeficitKcal;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) return null;
  return Math.ceil(-WEIGHT_RESPONSE_DAYS * Math.log1p(-fraction));
}
export function plannedWeightAt(goal: GoalRecord, date: string): number {
  const before = [...goal.trajectory].reverse().find((point) => point.date <= date);
  const after = goal.trajectory.find((point) => point.date >= date);
  if (!before) return goal.startWeightKg;
  if (!after || after.date === before.date) return before.targetWeightKg;
  const fraction = goalDaySpan(before.date, date) / goalDaySpan(before.date, after.date);
  return before.targetWeightKg + fraction * (after.targetWeightKg - before.targetWeightKg);
}
