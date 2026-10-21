import type { ActivityLogRecord, DailyGoalEnergy, FoodLogRecord, GoalForecast, GoalRecord, ProgressOverview } from "@healthcare/contracts";
import { getLocalDate } from "./goals.js";
import { goalDaySpan, plannedWeightAt, roundEnergy, roundWeight, shiftGoalDate, WEIGHT_ENERGY_FEEDBACK } from "./goal-energy.js";
import { summarizeActivityEnergy } from "./activity-energy.js";

type Measurement = { measuredAt: string; weightKg: number };
const median = (values: number[]) => quantile(values, 0.5);
function quantile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  return sorted[lower]! + (sorted[Math.ceil(position)]! - sorted[lower]!) * (position - lower);
}
const clampWeight = (weight: number) => roundWeight(Math.max(25, Math.min(400, weight)));

export function buildWeightForecast(goal: GoalRecord, dailyWeights: Array<{ date: string; weightKg: number }>, today: string): GoalForecast {
  const recent = dailyWeights.filter((point) => point.date >= shiftGoalDate(today, -27) && point.date >= goal.startDate && point.date <= today);
  const first = recent[0], last = recent.at(-1);
  const span = first && last ? goalDaySpan(first.date, last.date) : 0;
  const empty: GoalForecast = { status: "collecting", message: "Add weigh-ins on 6 days spanning at least 14 days to see a recent-pace forecast.", measuredDays: recent.length, spanDays: span, weeklyChangeKg: null, arrivalDate: null, earliestDate: null, latestDate: null, points: [] };
  if (recent.length < 6 || span < 14 || !first || !last) return empty;
  if (goalDaySpan(last.date, today) > 7) return { ...empty, status: "stale", message: "Add a recent weigh-in to update the forecast." };
  const slopes: number[] = [];
  for (let i = 0; i < recent.length; i++) for (let j = i + 1; j < recent.length; j++) {
    const days = goalDaySpan(recent[i]!.date, recent[j]!.date);
    if (days >= 7) slopes.push((recent[j]!.weightKg - recent[i]!.weightKg) / days);
  }
  const slope = median(slopes);
  const intercept = median(recent.map((point) => point.weightKg - slope * goalDaySpan(first.date, point.date)));
  const anchor = intercept + slope * goalDaySpan(first.date, last.date);
  const base = { ...empty, weeklyChangeKg: roundWeight(slope * 7) };
  if (Math.abs(slope * 7) > last.weightKg * 0.01) return { ...base, status: "outside_range", message: "Recent weight changes are too rapid or variable for a reliable arrival estimate. Check your weigh-ins and review the plan." };
  if (goal.direction === "maintain") return { ...base, status: "maintenance", message: `Recent measured change: ${roundWeight(slope * 7)} kg/week. Keep weighing in to follow stability.` };
  const sign = goal.direction === "lose" ? -1 : 1;
  if (sign * (goal.targetWeightKg - anchor) <= 0) return { ...base, status: "at_goal", message: "Your recent trend has reached the target. Review a maintenance plan when you’re ready." };
  if (slope * sign < 0.01 / 7) return { ...base, status: "not_approaching", message: "Your recent weight trend is not moving toward this target. Review intake, activity, or the goal date." };
  const days = Math.ceil((goal.targetWeightKg - anchor) / slope);
  const remaining = days - goalDaySpan(last.date, today);
  // A recent straight-line pace is not a long-term biological prediction.
  if (days <= 0 || remaining <= 0 || remaining > 180) return { ...base, status: "outside_range", message: "Keep tracking. Your recent pace does not support an arrival estimate within the next 6 months." };
  const lowerSlope = quantile(slopes, 0.25), upperSlope = quantile(slopes, 0.75);
  const arrivalFor = (rate: number) => {
    if (rate * sign < 0.01 / 7) return null;
    const n = Math.ceil((goal.targetWeightKg - anchor) / rate);
    return n > goalDaySpan(last.date, today) && n <= goalDaySpan(last.date, today) + 180 ? shiftGoalDate(last.date, n) : null;
  };
  const alternatives = [arrivalFor(lowerSlope), arrivalFor(upperSlope)].filter((date): date is string => date !== null).sort();
  const points: GoalForecast["points"] = [];
  const horizon = Math.min(goalDaySpan(last.date, today) + 90, days);
  const offsets = new Set([0, horizon]);
  for (let day = 7; day < horizon; day += 7) offsets.add(day);
  for (const day of [...offsets].sort((a, b) => a - b)) {
    const a = anchor + lowerSlope * day, b = anchor + upperSlope * day;
    points.push({ date: shiftGoalDate(last.date, day), weightKg: clampWeight(anchor + slope * day), lowKg: clampWeight(Math.min(a, b)), highKg: clampWeight(Math.max(a, b)) });
  }
  return { ...base, status: "ready", arrivalDate: shiftGoalDate(last.date, days), earliestDate: alternatives.length === 2 ? alternatives[0]! : null, latestDate: alternatives.length === 2 ? alternatives[1]! : null,
    message: "Recent-pace estimate. The shaded area shows variation between recent measured rates, not a statistical confidence interval. Future pace can change.", points };
}

export function buildProgressOverview(input: {
  goals: GoalRecord[]; measurements: Measurement[]; foods: FoodLogRecord[]; activities: ActivityLogRecord[];
  foodStatuses: Array<{ localDate: string; complete: boolean; checkIn?: DailyGoalEnergy["checkIn"]; checkInVersion?: number }>; timezone: string; today: string;
}): ProgressOverview | null {
  const goals = [...input.goals].sort((a, b) => a.goalVersion - b.goalVersion);
  const goal = goals.at(-1);
  if (!goal) return null;
  const dateOf = (instant: string) => getLocalDate(new Date(instant), input.timezone);
  const valuesByDate = new Map<string, number[]>();
  for (const point of input.measurements) {
    const date = dateOf(point.measuredAt);
    if (date > input.today) continue;
    valuesByDate.set(date, [...valuesByDate.get(date) ?? [], point.weightKg]);
  }
  const weights = [...valuesByDate].map(([date, values]) => ({ date, weightKg: median(values) })).sort((a, b) => a.date.localeCompare(b.date));
  const latest = weights.at(-1);
  const currentWeightKg = latest?.weightKg ?? goal.startWeightKg;
  const forecast = buildWeightForecast(goal, weights, input.today);
  const completeDates = new Set(input.foodStatuses.filter((row) => row.complete).map((row) => row.localDate));
  const statuses = new Map(input.foodStatuses.map((row) => [row.localDate, row]));
  const foodByDate = new Map<string, { count: number; calories: number; protein: number; carbohydrate: number; fat: number }>();
  for (const food of input.foods) {
    const date = dateOf(food.occurredAt), prior = foodByDate.get(date) ?? { count: 0, calories: 0, protein: 0, carbohydrate: 0, fat: 0 };
    foodByDate.set(date, { count: prior.count + 1, calories: prior.calories + food.nutritionTotal.caloriesKcal,
      protein: prior.protein + food.nutritionTotal.proteinG, carbohydrate: prior.carbohydrate + food.nutritionTotal.carbohydrateG, fat: prior.fat + food.nutritionTotal.fatG });
  }
  const activityByDate = new Map<string, ActivityLogRecord[]>();
  for (const activity of input.activities) {
    const date = dateOf(activity.occurredAt);
    activityByDate.set(date, [...activityByDate.get(date) ?? [], activity]);
  }
  const start = [goals[0]!.startDate, shiftGoalDate(input.today, -730)].sort().at(-1)!;
  const days: DailyGoalEnergy[] = [];
  for (let offset = 0; offset <= goalDaySpan(start, input.today); offset++) {
    const date = shiftGoalDate(start, offset);
    const active = [...goals].reverse().find((candidate) => candidate.startDate <= date && dateOf(candidate.acceptedAt) <= date);
    const weight = [...weights].reverse().find((point) => point.date <= date && (!active || point.date >= active.startDate));
    const food = foodByDate.get(date);
    const activities = activityByDate.get(date) ?? [];
    const energy = summarizeActivityEnergy(activities);
    const missingEnergy = energy.sessionsMissingEstimate + activities.filter((activity) => activity.activityType === "other" && Boolean(activity.durationMinutes)).length;
    const baseline = active?.budget ? Math.max(1, active.budget.baselineCaloriesKcal + WEIGHT_ENERGY_FEEDBACK * ((weight?.weightKg ?? active.startWeightKg) - active.startWeightKg)) : null;
    const expenditure = baseline === null ? null : roundEnergy(baseline + (energy.caloriesKcal ?? 0));
    const complete = completeDates.has(date) && Boolean(food?.count);
    days.push({ date, goalVersion: active?.goalVersion ?? null, targetCaloriesKcal: active?.dailyCaloriesKcal ?? null,
      checkIn: statuses.get(date)?.checkIn ?? { dayType: "regular", note: "", plannedRest: false }, checkInVersion: statuses.get(date)?.checkInVersion ?? 0,
      foodLogCount: food?.count ?? 0, proteinG: food ? roundWeight(food.protein) : null, carbohydrateG: food ? roundWeight(food.carbohydrate) : null, fatG: food ? roundWeight(food.fat) : null,
      workoutSessions: activities.filter((activity) => ["walk", "cardio", "strength"].includes(activity.activityType)).length,
      weightReadings: valuesByDate.get(date)?.length ?? 0,
      steps: activities.some((activity) => activity.activityType === "steps" && activity.steps !== null) ? activities.reduce((sum, activity) => sum + (activity.activityType === "steps" ? activity.steps ?? 0 : 0), 0) : null,
      intakeCaloriesKcal: food ? roundEnergy(food.calories) : null, foodDayComplete: complete,
      activityCaloriesKcal: energy.caloriesKcal ?? 0, activitiesMissingEnergy: missingEnergy,
      baselineCaloriesKcal: baseline === null ? null : roundEnergy(baseline), expenditureCaloriesKcal: expenditure,
      deficitCaloriesKcal: complete && expenditure !== null && missingEnergy === 0 ? roundEnergy(expenditure - food!.calories) : null,
      plannedDeficitCaloriesKcal: baseline !== null && active?.budget && active.dailyCaloriesKcal !== null ? roundEnergy(baseline + active.budget.plannedExerciseKcalPerDay - active.dailyCaloriesKcal) : null,
      weightKg: valuesByDate.has(date) ? median(valuesByDate.get(date)!) : null,
      weightSource: baseline === null ? null : weight ? "measurement" : "accepted_baseline",
      energyWeightKg: baseline === null || !active ? null : weight?.weightKg ?? active.startWeightKg,
      plannedWeightKg: active && date <= active.targetDate ? roundWeight(plannedWeightAt(active, date)) : null,
    });
  }
  const todayEnergy = days.at(-1);
  if (!todayEnergy) return null;
  const week = days.filter((day) => day.date >= shiftGoalDate(input.today, -6));
  const complete = week.filter((day) => day.foodDayComplete);
  const energyDays = week.filter((day) => day.deficitCaloriesKcal !== null);
  const sumDeficit = energyDays.reduce((sum, day) => sum + day.deficitCaloriesKcal!, 0);
  const total = goal.targetWeightKg - goal.startWeightKg;
  const sign = goal.direction === "lose" ? -1 : 1;
  const progressKg = goal.direction === "maintain" ? currentWeightKg - goal.startWeightKg : (currentWeightKg - goal.startWeightKg) * sign;
  return {
    policyVersion: "progress-budget-v1", timezone: input.timezone, today: input.today, goalVersion: goal.goalVersion,
    currentWeightKg: roundWeight(currentWeightKg), currentWeightDate: latest?.date ?? goal.startDate,
    progressKg: roundWeight(progressKg), remainingKg: roundWeight(goal.direction === "maintain" ? Math.abs(currentWeightKg - goal.targetWeightKg) : Math.max(0, (goal.targetWeightKg - currentWeightKg) * sign)),
    progressPercent: total === 0 || goal.direction === "maintain" ? 0 : Math.max(0, Math.min(100, roundEnergy(progressKg / Math.abs(total) * 100))),
    plannedWeeklyChangeKg: goal.budget?.sevenDayWeightChangeKg ?? roundWeight(total * 7 / Math.max(1, goalDaySpan(goal.startDate, goal.targetDate))),
    todayEnergy, days, forecast,
    weekly: {
      completeFoodDays: complete.length, energyDays: energyDays.length,
      averageIntakeKcal: complete.length ? roundEnergy(complete.reduce((sum, day) => sum + day.intakeCaloriesKcal!, 0) / complete.length) : null,
      averageDeficitKcal: energyDays.length ? roundEnergy(sumDeficit / energyDays.length) : null,
      recordedDeficitKcal: energyDays.length ? roundEnergy(sumDeficit) : null,
      plannedDeficitForRecordedDaysKcal: energyDays.length && energyDays.every((day) => day.plannedDeficitCaloriesKcal !== null) ? roundEnergy(energyDays.reduce((sum, day) => sum + day.plannedDeficitCaloriesKcal!, 0)) : null,
      activityCaloriesKcal: roundEnergy(week.reduce((sum, day) => sum + day.activityCaloriesKcal, 0)),
      message: complete.length < 4 ? "Mark food days complete to compare your intake with the plan. Missing meals stay unknown."
        : forecast.status === "not_approaching" ? "Review your complete food days and activity. You can revise intake or extend the date without losing this plan."
        : forecast.status === "ready" && forecast.arrivalDate! > goal.targetDate ? "Your recent pace points past the accepted date. Review a later date or a different daily budget."
        : "Keep the routine consistent and review the measured trend each week. Changes need your approval.",
    },
    milestones: goal.direction === "maintain" ? [] : [25, 50, 75, 100].map((percent) => ({ percent, weightKg: roundWeight(goal.startWeightKg + total * percent / 100), reached: progressKg >= Math.abs(total) * percent / 100 })),
  };
}
