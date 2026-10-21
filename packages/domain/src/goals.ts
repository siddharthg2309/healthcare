import type { GoalProposalRequest, GoalRecord, Profile } from "@healthcare/contracts";
import { activityMultipliers, daysForChange, deficitForChange, GOAL_ENERGY_MODEL, goalDaySpan, restingEnergy, roundEnergy, roundWeight, scenarioWeightChange, shiftGoalDate } from "./goal-energy.js";

export const GOAL_CALCULATION_POLICY_VERSION = "goal-budget-v3";
export type GoalProposal =
  | { status: "ready"; goal: Omit<GoalRecord, "goalVersion" | "acceptedAt">; notes: string[] }
  | { status: "manual_required"; reasonCode: "timeline_too_fast" | "clinician_target_required" | "estimate_out_of_range"; reasons: string[]; suggestedTargetDate?: string; suggestedDailyCalories?: number }
  | { status: "invalid"; reason: string };

export function getLocalDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)?.value;
  const year = part("year"), month = part("month"), day = part("day");
  if (!year || !month || !day) throw new Error("invalid_timezone");
  return `${year}-${month}-${day}`;
}

export function buildGoalProposal(profile: Profile, request: GoalProposalRequest, now = new Date()): GoalProposal {
  let startDate: string;
  try { startDate = getLocalDate(now, profile.timezone); }
  catch { return { status: "invalid", reason: "Choose a valid time zone." }; }
  const difference = request.targetWeightKg - profile.currentWeightKg;
  if (request.direction === "lose" && difference >= -0.1) return { status: "invalid", reason: "Choose a target below your current weight." };
  if (request.direction === "gain" && difference <= 0.1) return { status: "invalid", reason: "Choose a target above your current weight." };
  if (request.direction === "maintain" && Math.abs(difference) > 1) return { status: "invalid", reason: "Keep a maintenance target within 1 kg of your current weight." };
  const mode = request.planningMode;
  let targetDate = request.targetDate;
  let duration = goalDaySpan(startDate, targetDate);
  if (mode !== "intake" && (duration < 14 || duration > 730)) return { status: "invalid", reason: "Choose a date from 2 weeks to 2 years away." };
  const trackingOnly = mode === "weight_only";
  const restricted = profile.ageYears < 19 || profile.ageYears > 78 || profile.pregnancyOrBreastfeeding || profile.clinicianDirectedDiet;
  const equation = request.energyEquation ?? profile.energyEquation;
  const rmr = restingEnergy({ ...profile, energyEquation: equation });
  const baselineLevel = request.baselineActivityLevel ?? profile.activityLevel;
  // Baseline selection explicitly excludes exercise. Legacy inclusive multipliers
  // never receive another planned-exercise allowance.
  const exercise = request.baselineActivityLevel ? request.plannedExerciseKcalPerDay : 0;
  const baseline = rmr === null ? null : rmr * activityMultipliers[baselineLevel];
  const maintenance = baseline === null ? null : baseline + exercise;
  const clinician = request.manualDailyCalories !== null && request.manualTargetSource === "clinician";
  if (!trackingOnly && restricted && !clinician) return {
    status: "manual_required", reasonCode: "clinician_target_required",
    reasons: ["Use a clinician-provided calorie target for this profile, or continue with weight tracking."],
  };
  if (!trackingOnly && maintenance === null && request.manualDailyCalories === null) return {
    status: "manual_required", reasonCode: "estimate_out_of_range",
    reasons: ["Choose Female or Male under Calorie estimate in your profile, enter your own intake, or continue with weight tracking."],
  };
  if (mode === "intake" && maintenance === null) return {
    status: "manual_required", reasonCode: "estimate_out_of_range",
    reasons: ["An intake-based timeline needs a calorie estimate. Choose a dated tracking goal with your manual or clinician target instead."],
  };
  const limit = request.direction === "gain" ? 0.25 : 0.45;
  const minimumDays = Math.max(14, Math.ceil(Math.abs(difference) / limit * 7));
  let intake = trackingOnly ? null : request.manualDailyCalories;
  let deficit: number | null = null;
  if (!trackingOnly && maintenance !== null) {
    if (intake === null) {
      const adjustment = mode === "intake" ? request.direction === "lose" ? 350 : request.direction === "gain" ? -200 : 0
        : request.direction === "maintain" ? 0 : deficitForChange(difference, duration);
      intake = Math.round(maintenance - adjustment);
    }
    deficit = maintenance - intake;
    if (mode === "intake") {
      const days = request.direction === "maintain" ? Math.max(14, Math.min(730, duration || 84)) : daysForChange(difference, deficit);
      if (days === null || days > 730 || days < 14) return {
        status: "manual_required", reasonCode: "estimate_out_of_range",
        reasons: ["This intake does not reach that weight within 2 weeks to 2 years in the approximate model. Change intake, target weight, or planned activity; or choose a dated tracking goal."],
        suggestedDailyCalories: Math.max(1200, Math.min(5000, Math.round((maintenance - (request.direction === "gain" ? -200 : request.direction === "lose" ? 350 : 0)) / 10) * 10)),
      };
      duration = days;
      targetDate = shiftGoalDate(startDate, days);
    }
    const initialWeeklyChange = Math.abs(scenarioWeightChange(deficit, 7));
    if (!clinician && ((request.direction !== "maintain" && (duration < minimumDays || initialWeeklyChange > limit)) || intake < 1200 || intake > 5000)) {
      const safeDays = Math.min(730, Math.max(minimumDays, duration + 28));
      const preferredDeficit = request.direction === "lose" ? 350 : request.direction === "gain" ? -200 : 0;
      const alternativeDays = daysForChange(difference, preferredDeficit);
      return {
        status: "manual_required", reasonCode: "timeline_too_fast",
        reasons: [`This plan needs ${roundEnergy(intake).toLocaleString("en-IN")} kcal/day and an initial pace of ${initialWeeklyChange.toFixed(2)} kg/week, outside this app’s automatic limits. Extend the date, change intake, or review planned activity.`],
        suggestedTargetDate: shiftGoalDate(startDate, alternativeDays !== null && alternativeDays >= minimumDays && alternativeDays <= 730 ? alternativeDays : safeDays),
        suggestedDailyCalories: Math.max(1200, Math.min(5000, roundEnergy(maintenance - preferredDeficit))),
      };
    }
    const heightM = profile.heightCm / 100;
    if (!clinician && (profile.currentWeightKg / heightM ** 2 < 18.5 || request.targetWeightKg / heightM ** 2 < 18.5)) return {
      status: "manual_required", reasonCode: "clinician_target_required", reasons: ["This weight range needs clinician guidance for a calorie plan. You can continue with weight tracking."],
    };
  }
  const budget: GoalRecord["budget"] = maintenance !== null && baseline !== null && rmr !== null && deficit !== null && intake !== null && request.baselineActivityLevel
    ? {
      model: GOAL_ENERGY_MODEL, energyEquation: equation as "mifflin_female" | "mifflin_male", baselineActivityLevel: baselineLevel, restingCaloriesKcal: roundEnergy(rmr),
      profileSnapshot: { ageYears: profile.ageYears, heightCm: profile.heightCm, weightKg: profile.currentWeightKg },
      baselineCaloriesKcal: roundEnergy(baseline), plannedExerciseKcalPerDay: exercise, maintenanceCaloriesKcal: roundEnergy(maintenance),
      initialDailyDeficitKcal: roundEnergy(deficit), initialWeeklyDeficitKcal: roundEnergy(deficit * 7), initialThirtyDayDeficitKcal: roundEnergy(deficit * 30),
      sevenDayWeightChangeKg: roundWeight(scenarioWeightChange(deficit, 7)), thirtyDayWeightChangeKg: roundWeight(scenarioWeightChange(deficit, 30)),
      estimatedTargetDate: request.direction === "maintain" ? null : (() => { const days = daysForChange(difference, deficit); return days !== null && days <= 730 ? shiftGoalDate(startDate, days) : null; })(),
      durationDays: duration,
    } : undefined;
  const useScenarioPath = Boolean(budget && (mode === "intake" || request.manualDailyCalories === null));
  const trajectory: GoalRecord["trajectory"] = [];
  for (let day = 0; day < duration; day += 7) {
    const change = useScenarioPath && request.direction !== "maintain" ? scenarioWeightChange(deficit!, day) : difference * day / duration;
    trajectory.push({ date: shiftGoalDate(startDate, day), targetWeightKg: Math.max(25, Math.min(400, roundWeight(profile.currentWeightKg + change))) });
  }
  trajectory.push({ date: targetDate, targetWeightKg: request.direction === "maintain" || !useScenarioPath ? request.targetWeightKg
    : Math.max(25, Math.min(400, roundWeight(profile.currentWeightKg + scenarioWeightChange(deficit!, duration)))) });
  return { status: "ready", goal: {
    planningMode: mode, ...(budget ? { budget } : {}), direction: request.direction,
    startWeightKg: profile.currentWeightKg, targetWeightKg: request.targetWeightKg, startDate, targetDate,
    dailyCaloriesKcal: intake,
    macrosGrams: intake !== null && !clinician ? { protein: Math.round(intake * 0.2 / 4), carbohydrate: Math.round(intake * 0.5 / 4), fat: Math.round(intake * 0.3 / 9) } : null,
    calculationMode: trackingOnly ? "weight_only" : request.manualDailyCalories !== null ? "manual_target" : "automatic_estimate",
    calculationPolicyVersion: GOAL_CALCULATION_POLICY_VERSION,
    rationale: trackingOnly ? ["Tracks your chosen weight and date without a calorie allowance."] : [
      request.manualDailyCalories !== null ? "Uses the daily intake you confirmed." : "Uses your profile, daily movement outside workouts, and chosen timeline.",
      "Planned workout energy is included once. Logged workouts do not increase your food allowance.",
      "The weight scenario uses the Hall 2011 population approximation, not the full NIH model or a guaranteed arrival date.",
      "Initial weekly and 30-day calorie totals assume an unchanged deficit; the weight scenario allows energy needs to change.",
      ...(mode === "date" && request.manualDailyCalories !== null ? ["With a manual intake and date, the accepted line is your chosen schedule. The model arrival can differ."] : []),
    ], trajectory,
  }, notes: ["Your accepted plan stays unchanged until you approve a new version. Forecasts use measured weight trends separately."] };
}
