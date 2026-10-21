import type { GoalProposalRequest, GoalRecord, Profile } from "@healthcare/contracts";

export const GOAL_CALCULATION_POLICY_VERSION = "goal-target-v2";

export type GoalProposal =
  | {
      status: "ready";
      goal: Omit<GoalRecord, "goalVersion" | "acceptedAt">;
      notes: string[];
    }
  | { status: "manual_required"; reasons: string[] }
  | { status: "invalid"; reason: string };

const activityMultipliers: Record<Profile["activityLevel"], number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const maximumAutomaticPlanDays = 730;
const minimumAutomaticCalories = 1200;
const maximumAutomaticCalories = 5000;
const maximumAutomaticLossKgPerWeek = 0.45;
const maximumAutomaticGainKgPerWeek = 0.25;

function roundToNearest(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function getLocalDate(now: Date, timezone: string): string {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => dateParts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("invalid_timezone");
  return `${year}-${month}-${day}`;
}

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

function buildTrajectory(startDate: string, targetDate: string, startWeightKg: number, targetWeightKg: number) {
  const totalDays = daysBetween(startDate, targetDate);
  const points = [];
  for (let day = 0; day < totalDays; day += 7) {
    const fraction = day / totalDays;
    const date = new Date(Date.parse(`${startDate}T00:00:00.000Z`) + day * 86_400_000)
      .toISOString().slice(0, 10);
    points.push({
      date,
      targetWeightKg: roundToTenth(startWeightKg + (targetWeightKg - startWeightKg) * fraction),
    });
  }
  points.push({ date: targetDate, targetWeightKg: roundToTenth(targetWeightKg) });
  return points;
}

function getRmr(profile: Profile): number | null {
  if (profile.ageYears < 19 || profile.ageYears > 78) return null;
  if (profile.energyEquation === "mifflin_female") {
    return 10 * profile.currentWeightKg + 6.25 * profile.heightCm - 5 * profile.ageYears - 161;
  }
  if (profile.energyEquation === "mifflin_male") {
    return 10 * profile.currentWeightKg + 6.25 * profile.heightCm - 5 * profile.ageYears + 5;
  }
  return null;
}

export function buildGoalProposal(
  profile: Profile,
  request: GoalProposalRequest,
  now = new Date(),
): GoalProposal {
  let startDate: string;
  try {
    startDate = getLocalDate(now, profile.timezone);
  } catch {
    return { status: "invalid", reason: "Choose a valid time zone before creating a goal." };
  }

  const durationDays = daysBetween(startDate, request.targetDate);
  if (durationDays < 14 || durationDays > maximumAutomaticPlanDays) {
    return { status: "invalid", reason: "Choose a target date from 2 weeks to 2 years from today." };
  }

  const weightDifference = request.targetWeightKg - profile.currentWeightKg;
  if (request.direction === "lose" && weightDifference >= -0.1) {
    return { status: "invalid", reason: "A weight-loss target must be below your current weight." };
  }
  if (request.direction === "gain" && weightDifference <= 0.1) {
    return { status: "invalid", reason: "A weight-gain target must be above your current weight." };
  }
  if (request.direction === "maintain" && Math.abs(weightDifference) > 1) {
    return { status: "invalid", reason: "For a maintenance goal, set the target within 1 kg of your current weight." };
  }

  const weeklyChangeKg = Math.abs(weightDifference) * 7 / durationDays;
  const fastChange = request.direction === "lose"
    ? weeklyChangeKg > maximumAutomaticLossKgPerWeek
    : request.direction === "gain" && weeklyChangeKg > maximumAutomaticGainKgPerWeek;
  const needsClinicianSuppliedTarget = profile.ageYears < 18
    || profile.pregnancyOrBreastfeeding
    || profile.clinicianDirectedDiet;

  if (fastChange && request.manualTargetSource !== "clinician") {
    return {
      status: "manual_required",
      reasons: ["This timeline is faster than the app's automatic planning limit. Choose a clinician-provided target or revise the timeline."],
    };
  }

  if (needsClinicianSuppliedTarget && (request.manualDailyCalories === null || request.manualTargetSource !== "clinician")) {
    return {
      status: "manual_required",
      reasons: ["This profile needs a clinician-provided calorie target. The app can still track food, activity, and measurements."],
    };
  }

  const baseNotes = [
    "The graph is a straight line between the starting and target weights you chose; it is not a forecast of actual body weight.",
  ];

  let dailyCaloriesKcal: number | null;
  let macrosGrams: GoalRecord["macrosGrams"];
  let calculationMode: GoalRecord["calculationMode"];
  let rationale: string[];

  if (request.manualDailyCalories !== null) {
    if (!request.manualTargetSource) {
      return { status: "invalid", reason: "Choose whether this calorie target came from you or a clinician." };
    }
    if (needsClinicianSuppliedTarget && request.manualTargetSource !== "clinician") {
      return {
        status: "manual_required",
        reasons: ["A clinician-provided target is required for this profile."],
      };
    }
    dailyCaloriesKcal = request.manualDailyCalories;
    macrosGrams = null;
    calculationMode = "manual_target";
    rationale = [
      request.manualTargetSource === "clinician"
        ? "Uses the calorie target marked as clinician-provided by the user."
        : "Uses the calorie target entered by the user.",
      "Macro targets are not estimated for a manually supplied calorie target.",
    ];
  } else {
    if (request.manualTargetSource !== null) {
      return { status: "invalid", reason: "Clear the manual target source or enter a manual calorie target." };
    }
    if (needsClinicianSuppliedTarget) {
      return {
        status: "manual_required",
        reasons: ["This profile needs a clinician-provided calorie target. The app can still track food, activity, and measurements."],
      };
    }

    const rmr = getRmr(profile);
    if (rmr === null) {
      dailyCaloriesKcal = null;
      macrosGrams = null;
      calculationMode = "weight_only";
      rationale = ["This goal follows the weight and date you chose. No calorie or macro target is set."];
    } else {
      const estimatedMaintenance = rmr * activityMultipliers[profile.activityLevel];
      const adjustment = request.direction === "lose" ? -250 : request.direction === "gain" ? 250 : 0;
      dailyCaloriesKcal = roundToNearest(estimatedMaintenance + adjustment, 50);
      if (dailyCaloriesKcal < minimumAutomaticCalories || dailyCaloriesKcal > maximumAutomaticCalories) {
        return {
          status: "manual_required",
          reasons: ["The estimate is outside the app's automatic calorie range. Enter a target supplied by you or a clinician."],
        };
      }

      macrosGrams = {
        protein: Math.round(dailyCaloriesKcal * 0.2 / 4),
        carbohydrate: Math.round(dailyCaloriesKcal * 0.5 / 4),
        fat: Math.round(dailyCaloriesKcal * 0.3 / 9),
      };
      calculationMode = "automatic_estimate";
      rationale = [
        "Uses the Mifflin–St Jeor resting-energy estimate and the activity level selected by the user.",
        "Applies an app-selected 250 kcal adjustment for weight change; this is an estimate, not a medical prescription.",
        "Macro amounts use a default 20% protein, 50% carbohydrate, and 30% fat energy split.",
      ];
    }
  }

  const trajectory = buildTrajectory(
    startDate,
    request.targetDate,
    profile.currentWeightKg,
    request.targetWeightKg,
  );

  return {
    status: "ready",
    goal: {
      direction: request.direction,
      startWeightKg: profile.currentWeightKg,
      targetWeightKg: request.targetWeightKg,
      startDate,
      targetDate: request.targetDate,
      dailyCaloriesKcal,
      macrosGrams,
      calculationMode,
      calculationPolicyVersion: GOAL_CALCULATION_POLICY_VERSION,
      rationale,
      trajectory,
    },
    notes: dailyCaloriesKcal === null
      ? [...baseNotes, "No calorie or macro target is set. Food totals remain available without a daily calorie allowance."]
      : [...baseNotes, "The calorie target is an estimate and does not add workout calories back to your food allowance."],
  };
}
