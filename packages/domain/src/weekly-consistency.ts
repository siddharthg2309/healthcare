import type { DailyGoalEnergy } from "@healthcare/contracts";
import { goalDaySpan, roundEnergy, roundWeight, shiftGoalDate } from "./goal-energy.js";

export function mondayOfWeek(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return shiftGoalDate(date, -((weekday + 6) % 7));
}

export function calorieDayComparison(day: DailyGoalEnergy) {
  if (!day.foodDayComplete || day.intakeCaloriesKcal === null) return { status: "incomplete" as const, differenceKcal: null, toleranceKcal: null };
  if (day.targetCaloriesKcal === null) return { status: "no_target" as const, differenceKcal: null, toleranceKcal: null };
  const differenceKcal = Math.round(day.intakeCaloriesKcal - day.targetCaloriesKcal);
  const toleranceKcal = Math.max(100, Math.round(day.targetCaloriesKcal * 0.1));
  return { status: Math.abs(differenceKcal) <= toleranceKcal ? "near_plan" as const : differenceKcal > 0 ? "above_plan" as const : "below_plan" as const, differenceKcal, toleranceKcal };
}

export function dailyLoggingStreak(days: DailyGoalEnergy[], today: string, kind: "food" | "weight"): number {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const done = (date: string) => { const day = byDate.get(date); return Boolean(day && (kind === "food" ? day.foodDayComplete : day.weightKg !== null)); };
  // An unfinished today does not break yesterday's streak before the day ends.
  let date = done(today) ? today : shiftGoalDate(today, -1), streak = 0;
  while (byDate.has(date) && done(date)) { streak++; date = shiftGoalDate(date, -1); }
  return streak;
}

export function buildWeeklyConsistencyReport(days: DailyGoalEnergy[], today: string, startDate = mondayOfWeek(today)) {
  const endDate = shiftGoalDate(startDate, 6);
  const byDate = new Map(days.map((day) => [day.date, day]));
  const rows = Array.from({ length: 7 }, (_, offset) => {
    const date = shiftGoalDate(startDate, offset), day = byDate.get(date) ?? null;
    return { date, day, future: date > today, tracked: Boolean(day && day.goalVersion !== null), comparison: day ? calorieDayComparison(day) : null };
  });
  const eligible = rows.flatMap((row) => !row.future && row.tracked && row.day ? [row.day] : []);
  const complete = eligible.filter((day) => day.foodDayComplete && day.intakeCaloriesKcal !== null);
  const weighed = eligible.filter((day) => day.weightKg !== null);
  const past = eligible.filter((day) => day.date < today);
  const nearPlan = complete.filter((day) => calorieDayComparison(day).status === "near_plan");
  const abovePlan = complete.filter((day) => calorieDayComparison(day).status === "above_plan");
  const belowPlan = complete.filter((day) => calorieDayComparison(day).status === "below_plan");
  const cheatDays = eligible.filter((day) => day.checkIn.dayType === "cheat");
  const restDays = eligible.filter((day) => day.checkIn.plannedRest);
  const activeDays = eligible.filter((day) => day.workoutSessions > 0 || (day.steps ?? 0) > 0);
  const energyDays = eligible.filter((day) => day.deficitCaloriesKcal !== null);
  const first = weighed[0], last = weighed.at(-1);
  const missingFood = past.filter((day) => !day.foodDayComplete).length;
  const missingWeight = past.filter((day) => day.weightKg === null).length;
  const message = !eligible.length ? "No tracking days in this week yet."
    : missingFood > 0 ? `You completed ${complete.length} of ${eligible.length} food days. ${missingFood} past ${missingFood === 1 ? "day needs" : "days need"} a food-log check-in.`
    : missingWeight > 0 ? `${complete.length} food ${complete.length === 1 ? "day is" : "days are"} complete. ${missingWeight} past ${missingWeight === 1 ? "day has" : "days have"} no weigh-in; record it only if you have the actual value.`
    : complete.length === eligible.length ? "You kept your food check-ins up to date. Keep showing up; a higher-calorie day does not reset your logging streak."
    : "A little more logging will complete this week's picture. Start with today's food check-in.";
  return {
    startDate, endDate, rows, expectedDays: eligible.length, completeFoodDays: complete.length, weighedDays: weighed.length,
    activeDays: activeDays.length, restDays: restDays.length, cheatDays: cheatDays.length, nearPlanDays: nearPlan.length, abovePlanDays: abovePlan.length, belowPlanDays: belowPlan.length,
    missingFoodDays: missingFood, missingWeightDays: missingWeight,
    averageCaloriesKcal: complete.length ? roundEnergy(complete.reduce((sum, day) => sum + day.intakeCaloriesKcal!, 0) / complete.length) : null,
    totalCaloriesOnCompleteDaysKcal: complete.length ? roundEnergy(complete.reduce((sum, day) => sum + day.intakeCaloriesKcal!, 0)) : null,
    averageProteinG: complete.length ? roundWeight(complete.reduce((sum, day) => sum + (day.proteinG ?? 0), 0) / complete.length) : null,
    averageWeightKg: weighed.length ? roundWeight(weighed.reduce((sum, day) => sum + day.weightKg!, 0) / weighed.length) : null,
    energyDays: energyDays.length,
    averageDeficitKcal: energyDays.length ? roundEnergy(energyDays.reduce((sum, day) => sum + day.deficitCaloriesKcal!, 0) / energyDays.length) : null,
    recordedDeficitKcal: energyDays.length ? roundEnergy(energyDays.reduce((sum, day) => sum + day.deficitCaloriesKcal!, 0)) : null,
    plannedDeficitForRecordedDaysKcal: energyDays.length && energyDays.every((day) => day.plannedDeficitCaloriesKcal !== null) ? roundEnergy(energyDays.reduce((sum, day) => sum + day.plannedDeficitCaloriesKcal!, 0)) : null,
    recordedWeightChangeKg: first && last && first.date !== last.date ? roundWeight(last.weightKg! - first.weightKg!) : null,
    weightSpanDays: first && last ? goalDaySpan(first.date, last.date) : 0,
    foodStreak: dailyLoggingStreak(days, today, "food"), weightStreak: dailyLoggingStreak(days, today, "weight"), message,
  };
}

/** Convert a historical local noon to an instant; avoids the viewer's zone changing the logged day. */
export function localNoonInstant(date: string, timezone: string): string {
  const desired = Date.parse(`${date}T12:00:00Z`);
  let instant = desired;
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let pass = 0; pass < 3; pass++) {
    const parts = format.formatToParts(new Date(instant));
    const get = (key: string) => parts.find((part) => part.type === key)?.value ?? "00";
    const displayed = Date.parse(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`);
    instant += desired - displayed;
  }
  return new Date(instant).toISOString();
}
