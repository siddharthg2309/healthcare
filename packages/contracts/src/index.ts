import { z } from "zod";

const uuidSchema = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });
const foodPreferencesSchema = z.object({
  pattern: z.enum(["no_preference", "vegetarian", "non_vegetarian", "mixed"]).default("no_preference"),
  vegetarianWeekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
}).strict().superRefine((preferences, context) => {
  if (new Set(preferences.vegetarianWeekdays).size !== preferences.vegetarianWeekdays.length) {
    context.addIssue({ code: "custom", path: ["vegetarianWeekdays"], message: "Select each vegetarian weekday only once." });
  }
  if (preferences.pattern === "mixed" && (preferences.vegetarianWeekdays.length < 1 || preferences.vegetarianWeekdays.length > 6)) {
    context.addIssue({ code: "custom", path: ["vegetarianWeekdays"], message: "Choose one to six vegetarian days for a mixed week." });
  }
  if (preferences.pattern !== "mixed" && preferences.vegetarianWeekdays.length > 0) {
    context.addIssue({ code: "custom", path: ["vegetarianWeekdays"], message: "Vegetarian weekdays are only used for a mixed weekly pattern." });
  }
});

export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  ageYears: z.number().int().min(13).max(110),
  heightCm: z.number().min(80).max(250),
  currentWeightKg: z.number().min(25).max(400),
  unitSystem: z.enum(["metric", "imperial"]),
  energyEquation: z.enum(["mifflin_female", "mifflin_male", "manual", "not_provided"]),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  timezone: z.string().min(1).max(80).refine((value) => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
  }, "Choose a valid time zone."),
  foodPreferences: foodPreferencesSchema.default({ pattern: "no_preference", vegetarianWeekdays: [] }),
  dietaryPreferences: z.array(z.string().trim().min(1).max(48)).max(30),
  restrictions: z.array(z.string().trim().min(1).max(80)).max(50),
  equipment: z.array(z.string().trim().min(1).max(80)).max(50),
  availableWorkoutDays: z.number().int().min(0).max(7),
  gymWorkoutDays: z.number().int().min(0).max(7).optional(),
  homeWorkoutDays: z.number().int().min(0).max(7).optional(),
  trainingExperience: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
  preferredWorkoutMinutes: z.number().int().min(10).max(180).default(45),
  movementLimitations: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  pregnancyOrBreastfeeding: z.boolean(),
  clinicianDirectedDiet: z.boolean(),
}).strict().superRefine((profile, context) => {
  if (profile.gymWorkoutDays !== undefined && profile.homeWorkoutDays !== undefined) {
    const locationDays = profile.gymWorkoutDays + profile.homeWorkoutDays;
    if (locationDays > 7) {
      context.addIssue({ code: "custom", path: ["homeWorkoutDays"], message: "Gym and home days cannot add up to more than seven." });
    }
    if (locationDays !== profile.availableWorkoutDays) {
      context.addIssue({ code: "custom", path: ["availableWorkoutDays"], message: "Total workout days must equal gym days plus home days." });
    }
  }
});

export const reminderKindSchema = z.enum(["breakfast", "lunch", "dinner", "workout", "weigh_in"]);

export const reminderPreferencesRequestSchema = z.object({
  browserNotificationsEnabled: z.boolean(),
  rules: z.array(z.object({
    kind: reminderKindSchema,
    enabled: z.boolean(),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  }).strict()).length(5),
}).strict().superRefine((value, context) => {
  if (new Set(value.rules.map((rule) => rule.kind)).size !== value.rules.length) {
    context.addIssue({ code: "custom", path: ["rules"], message: "Each reminder type must appear once." });
  }
});

export const reminderPreferencesResponseSchema = reminderPreferencesRequestSchema.extend({
  timezone: z.string().min(1).max(80),
}).strict();

export const deleteAccountRequestSchema = z.object({
  password: z.string().min(12).max(128).optional(),
  confirmation: z.literal("DELETE"),
}).strict();

export const goalProposalRequestSchema = z.object({
  planningMode: z.enum(["date", "intake", "weight_only"]).default("date"),
  baselineActivityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]).optional(),
  energyEquation: z.enum(["mifflin_female", "mifflin_male", "not_provided"]).optional(),
  plannedExerciseKcalPerDay: z.number().int().min(0).max(1000).default(0),
  direction: z.enum(["lose", "gain", "maintain"]),
  targetWeightKg: z.number().finite().min(25).max(400),
  targetDate: z.string().date(),
  manualDailyCalories: z.number().int().min(800).max(5000).nullable(),
  manualTargetSource: z.enum(["self", "clinician"]).nullable(),
}).strict().superRefine((value, context) => {
  if (value.manualDailyCalories === null && value.manualTargetSource !== null) {
    context.addIssue({ code: "custom", path: ["manualTargetSource"], message: "A target source needs a manual calorie target." });
  }
  if (value.manualDailyCalories !== null && value.manualTargetSource === null) {
    context.addIssue({ code: "custom", path: ["manualTargetSource"], message: "Choose who supplied the manual target." });
  }
});

export const acceptGoalRequestSchema = z.object({
  proposalFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  goalId: uuidSchema,
  measurementId: uuidSchema,
  request: goalProposalRequestSchema,
  accepted: z.literal(true),
}).strict();

export const createMeasurementRequestSchema = z.object({
  measurementId: uuidSchema,
  measuredAt: isoDateTime,
  weightKg: z.number().finite().min(25).max(400),
}).strict();

const trajectoryPointSchema = z.object({
  date: z.string().date(),
  targetWeightKg: z.number().finite().min(25).max(400),
}).strict();

export const goalBudgetSchema = z.object({
  model: z.literal("hall_reduced_v1"),
  energyEquation: z.enum(["mifflin_female", "mifflin_male"]),
  profileSnapshot: z.object({ ageYears: z.number().int(), heightCm: z.number().finite(), weightKg: z.number().finite() }).strict(),
  baselineActivityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  restingCaloriesKcal: z.number().finite().positive(),
  baselineCaloriesKcal: z.number().finite().positive(),
  plannedExerciseKcalPerDay: z.number().finite().min(0),
  maintenanceCaloriesKcal: z.number().finite().positive(),
  initialDailyDeficitKcal: z.number().finite(),
  initialWeeklyDeficitKcal: z.number().finite(),
  initialThirtyDayDeficitKcal: z.number().finite(),
  sevenDayWeightChangeKg: z.number().finite(),
  thirtyDayWeightChangeKg: z.number().finite(),
  estimatedTargetDate: z.string().date().nullable(),
  durationDays: z.number().int().min(14).max(730),
}).strict();

export const goalSchema = z.object({
  acceptanceRequestHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  planningMode: z.enum(["date", "intake", "weight_only"]).optional(),
  budget: goalBudgetSchema.optional(),
  goalVersion: z.number().int().positive(),
  direction: z.enum(["lose", "gain", "maintain"]),
  startWeightKg: z.number().finite().min(25).max(400),
  targetWeightKg: z.number().finite().min(25).max(400),
  startDate: z.string().date(),
  targetDate: z.string().date(),
  dailyCaloriesKcal: z.number().int().min(800).max(5000).nullable(),
  macrosGrams: z.object({
    protein: z.number().finite().min(0).max(500),
    carbohydrate: z.number().finite().min(0).max(1000),
    fat: z.number().finite().min(0).max(500),
  }).strict().nullable(),
  calculationMode: z.enum(["automatic_estimate", "manual_target", "weight_only"]),
  calculationPolicyVersion: z.string().min(1).max(40),
  rationale: z.array(z.string().min(1).max(180)).max(10),
  trajectory: z.array(trajectoryPointSchema).min(2).max(106),
  acceptedAt: isoDateTime,
}).strict();

const foodLogSchema = z.object({
  catalogFoodId: uuidSchema,
  occurredAt: isoDateTime,
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  quantityGrams: z.number().finite().positive().max(5000),
}).strict();

export const createFoodLogRequestSchema = z.object({
  logId: uuidSchema,
  foodId: uuidSchema,
  portionId: uuidSchema.nullable().optional(),
  portionCount: z.number().min(0.5).max(50).multipleOf(0.5).optional(),
  occurredAt: isoDateTime,
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  quantityGrams: z.number().finite().positive().max(5000),
}).strict();

export const copyFoodLogsRequestSchema = z.object({
  sourceDate: z.string().date(),
  targetDate: z.string().date(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  entries: z.array(z.object({
    sourceLogId: uuidSchema,
    logId: uuidSchema,
  }).strict()).min(1).max(20),
}).strict().superRefine((value, context) => {
  const sourceIds = value.entries.map((entry) => entry.sourceLogId);
  const destinationIds = value.entries.map((entry) => entry.logId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Each source food log can be copied only once." });
  }
  if (new Set(destinationIds).size !== destinationIds.length || value.entries.some((entry) => entry.sourceLogId === entry.logId)) {
    context.addIssue({ code: "custom", path: ["entries"], message: "Every copied food log needs a unique new ID." });
  }
});

export const foodPhotoRecognitionRequestSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(128).max(3_333_336).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  context: z.string().trim().max(4000).optional(),
}).strict();

export const foodTextEstimateRequestSchema = z.object({
  foodName: z.string().trim().min(1).max(100),
  context: z.string().trim().max(4000).optional(),
}).strict();

export const photoNutritionSchema = z.object({
  caloriesKcal: z.number().finite().min(0).max(1000),
  proteinG: z.number().finite().min(0).max(100),
  carbohydrateG: z.number().finite().min(0).max(100),
  fatG: z.number().finite().min(0).max(100),
}).strict().refine((value) => value.proteinG + value.carbohydrateG + value.fatG <= 105, "Check macros per 100 g.");

export const foodPhotoEstimateSchema = z.object({
  items: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    minimumGrams: z.number().finite().min(1).max(5000),
    maximumGrams: z.number().finite().min(1).max(5000),
    confidence: z.enum(["high", "medium", "low"]),
    nutritionPer100g: photoNutritionSchema,
  }).strict().refine((item) => item.minimumGrams <= item.maximumGrams, "Check the portion range.")).max(6),
  question: z.string().trim().min(1).max(240).nullable(),
  note: z.string().trim().max(240).nullable(),
}).strict();

export const foodPhotoRecognitionResponseSchema = foodPhotoEstimateSchema.extend({
  draftToken: z.string().min(40).max(20000),
  inputType: z.enum(["photo", "text"]).default("photo"),
  // Older open clients can still read the previous candidate response.
  candidates: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    alternatives: z.array(z.string().trim().min(1).max(100)).max(3),
  }).strict()).max(6),
}).strict();

export const confirmFoodPhotoRequestSchema = z.object({
  requestId: uuidSchema,
  draftToken: z.string().min(40).max(20000),
  occurredAt: isoDateTime,
  // Accept the old checkbox field, but always save confirmed estimates for reuse.
  saveToMyFoods: z.boolean().optional().transform(() => true),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  items: z.array(z.object({
    index: z.number().int().min(0).max(5),
    name: z.string().trim().min(1).max(100),
    minimumGrams: z.number().finite().min(1).max(5000),
    maximumGrams: z.number().finite().min(1).max(5000),
    certainty: z.enum(["sure", "not_sure"]),
    nutritionPer100g: photoNutritionSchema.optional(),
  }).strict().refine((item) => item.minimumGrams <= item.maximumGrams, "Check the portion range.")
    .refine((item) => item.certainty !== "sure" || item.minimumGrams === item.maximumGrams, "Enter one amount when sure.")).min(1).max(6),
}).strict().refine((value) => new Set(value.items.map((item) => item.index)).size === value.items.length, "Duplicate photo items.");

export const updateFoodLogRequestSchema = z.object({
  baseVersion: z.number().int().positive(),
  occurredAt: isoDateTime.optional(),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).optional(),
  quantityGrams: z.number().finite().positive().max(5000).optional(),
}).strict().superRefine((value, context) => {
  if (value.occurredAt === undefined && value.mealType === undefined && value.quantityGrams === undefined) {
    context.addIssue({ code: "custom", path: [], message: "Provide at least one field to update." });
  }
});

export const deleteFoodLogRequestSchema = z.object({
  baseVersion: z.number().int().positive(),
}).strict();

export const foodDayStatusRequestSchema = z.object({
  complete: z.boolean(),
}).strict();

export const dailyCheckInSchema = z.object({
  dayType: z.enum(["regular", "cheat"]).default("regular"),
  note: z.string().trim().max(280).default(""),
  plannedRest: z.boolean().default(false),
}).strict();
export const dailyCheckInRequestSchema = dailyCheckInSchema.extend({
  baseVersion: z.number().int().min(0),
}).strict();

export const createCustomFoodRequestSchema = z.object({
  foodId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(80)).max(20).default([])
    .transform((values) => [...new Map(values.map((value) => [value.toLocaleLowerCase(), value])).values()]),
  category: z.enum(["ingredient", "prepared_meal", "snack", "beverage", "restaurant", "other"]),
  caloriesKcalPer100g: z.number().finite().min(0).max(1000),
  proteinGPer100g: z.number().finite().min(0).max(100),
  carbohydrateGPer100g: z.number().finite().min(0).max(100),
  fatGPer100g: z.number().finite().min(0).max(100),
  sourceNote: z.string().trim().min(1).max(160),
}).strict();

export const createFoodRecipeRequestSchema = z.object({
  recipeId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(80)).max(20).default([])
    .transform((values) => [...new Map(values.map((value) => [value.toLocaleLowerCase(), value])).values()]),
  yieldGrams: z.number().int().min(1).max(50000),
  ingredients: z.array(z.object({
    foodId: uuidSchema,
    foodSource: z.enum(["shared_catalog", "personal"]),
    quantityGrams: z.number().int().min(1).max(5000),
  }).strict()).min(2).max(20),
  instructions: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
}).strict();

export const updateFoodRecipeRequestSchema = createFoodRecipeRequestSchema
  .omit({ recipeId: true })
  .extend({ baseVersion: z.number().int().positive() })
  .strict();

export const setFoodFavoriteRequestSchema = z.object({
  foodSource: z.enum(["shared_catalog", "personal"]),
  favorite: z.boolean(),
}).strict();

export const createFoodPortionRequestSchema = z.object({
  foodSource: z.enum(["shared_catalog", "personal"]),
  label: z.string().trim().min(1).max(40),
  grams: z.number().int().min(1).max(5000),
}).strict();

export const nutritionSnapshotSchema = z.object({
  caloriesKcal: z.number().finite().min(0),
  proteinG: z.number().finite().min(0),
  carbohydrateG: z.number().finite().min(0),
  fatG: z.number().finite().min(0),
}).strict();

const foodEstimateMetadataSchema = z.object({
  runId: uuidSchema,
  model: z.string().min(1).max(100),
  minimumGrams: z.number().finite().min(1).max(5000),
  maximumGrams: z.number().finite().min(1).max(5000),
  certainty: z.enum(["sure", "not_sure"]),
  confidence: z.enum(["high", "medium", "low"]),
  userAdjusted: z.boolean(),
  requestId: uuidSchema,
  itemIndex: z.number().int().min(0).max(5),
}).strict();

export const foodLogRecordSchema = z.object({
  foodId: uuidSchema,
  foodSource: z.enum(["shared_catalog", "personal", "photo_estimate", "text_estimate"]),
  foodName: z.string().min(1).max(120),
  category: z.string().min(1).max(48),
  occurredAt: isoDateTime,
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  quantityGrams: z.number().finite().positive().max(5000),
  portionId: uuidSchema.nullable().optional(),
  portionLabel: z.string().trim().min(1).max(80).nullable().optional(),
  portionCount: z.number().min(0.5).max(50).multipleOf(0.5).nullable().optional(),
  nutritionPer100g: nutritionSnapshotSchema,
  nutritionTotal: nutritionSnapshotSchema,
  photoEstimate: foodEstimateMetadataSchema.optional(),
  foodEstimate: foodEstimateMetadataSchema.extend({
    inputType: z.enum(["photo", "text"]),
    savedToMyFoods: z.boolean(),
  }).optional(),
  nutritionProvenance: z.enum(["catalog", "user", "ai_estimate"]).optional(),
}).strict();

const workoutSetSchema = z.object({
  reps: z.number().int().min(1).max(200).nullable().optional(),
  durationSeconds: z.number().int().min(1).max(7200).nullable().optional(),
  loadKg: z.number().finite().min(0).max(1000).nullable(),
}).strict().superRefine((value, context) => {
  const hasReps = value.reps !== null && value.reps !== undefined;
  const hasDuration = value.durationSeconds !== null && value.durationSeconds !== undefined;
  if (hasReps === hasDuration) {
    context.addIssue({ code: "custom", path: ["reps"], message: "Enter either reps or a timed hold for each set." });
  }
  if (hasDuration && value.loadKg !== null) {
    context.addIssue({ code: "custom", path: ["loadKg"], message: "Timed sets cannot include an external load." });
  }
});

const workoutExerciseSchema = z.object({
  exerciseId: z.string().trim().min(1).max(80).nullable().optional(),
  exerciseName: z.string().trim().min(1).max(100),
  sets: z.array(workoutSetSchema).min(1).max(20),
}).strict().superRefine((value, context) => {
  const timed = value.sets.some((set) => set.durationSeconds !== null && set.durationSeconds !== undefined);
  const repBased = value.sets.some((set) => set.reps !== null && set.reps !== undefined);
  if (timed && repBased) {
    context.addIssue({ code: "custom", path: ["sets"], message: "All sets for one exercise must use the same tracking mode." });
  }
});

const plannedWorkoutSessionReferenceSchema = z.object({
  planId: uuidSchema,
  planVersion: z.number().int().positive(),
  weekday: z.number().int().min(0).max(6),
  label: z.string().trim().min(1).max(80),
}).strict();

export const activityEnergyKindSchema = z.enum([
  "walk_slow", "walk_moderate", "walk_brisk", "aerobics", "jogging",
  "stationary_cycle", "elliptical", "rowing", "strength_general", "strength_vigorous", "bodyweight",
]);

export const activityEnergyEstimateSchema = z.object({
  method: z.literal("compendium_2024_net_v1"),
  caloriesKcal: z.number().int().min(0).max(100000),
  met: z.number().finite().min(1).max(30),
  compendiumCode: z.string().regex(/^\d{5}$/),
  weightKg: z.number().finite().min(25).max(400),
  weightSource: z.enum(["measurement", "profile"]),
  weightMeasuredAt: isoDateTime.nullable(),
}).strict();

const activityLogSchema = z.object({
  activityType: z.enum(["steps", "walk", "cardio", "strength", "other"]),
  occurredAt: isoDateTime,
  energyKind: activityEnergyKindSchema.optional(),
  durationMinutes: z.number().int().min(0).max(1440).nullable(),
  steps: z.number().int().min(0).max(200000).nullable(),
  notes: z.string().trim().max(500).nullable(),
  workoutTitle: z.string().trim().min(1).max(100).optional(),
  exercises: z.array(workoutExerciseSchema).min(1).max(20).optional(),
  plannedSession: plannedWorkoutSessionReferenceSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.activityType !== "strength" && value.plannedSession !== undefined) {
    context.addIssue({ code: "custom", path: ["plannedSession"], message: "Only a strength session can be linked to a workout plan." });
  }
  const setCount = value.exercises?.reduce((total, exercise) => total + exercise.sets.length, 0) ?? 0;
  if (setCount > 100) context.addIssue({ code: "custom", path: ["exercises"], message: "A workout can contain at most 100 sets." });
});

export const createActivityLogRequestSchema = z.object({
  activityId: uuidSchema,
  activityType: z.enum(["steps", "walk", "cardio", "strength", "other"]),
  occurredAt: isoDateTime,
  energyKind: activityEnergyKindSchema.optional(),
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
  steps: z.number().int().min(0).max(200000).nullable(),
  notes: z.string().trim().max(500).nullable(),
  workoutTitle: z.string().trim().min(1).max(100).optional(),
  exercises: z.array(workoutExerciseSchema).min(1).max(20).optional(),
  plannedSession: plannedWorkoutSessionReferenceSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.durationMinutes === null && value.steps === null && !(value.activityType === "strength" && value.exercises?.length)) {
    context.addIssue({ code: "custom", path: ["durationMinutes"], message: "Enter a duration or step count." });
  }
  if (value.activityType === "steps" && value.steps === null) {
    context.addIssue({ code: "custom", path: ["steps"], message: "Enter a step count for a steps entry." });
  }
  if (value.activityType === "strength" && ((value.workoutTitle === undefined) !== (value.exercises === undefined) || (value.workoutTitle !== undefined && !value.exercises?.length))) {
    context.addIssue({ code: "custom", path: ["exercises"], message: "Provide both a workout name and at least one exercise with sets." });
  }
  if (value.activityType !== "strength" && (value.workoutTitle !== undefined || value.exercises !== undefined)) {
    context.addIssue({ code: "custom", path: ["exercises"], message: "Strength details are only valid for a strength session." });
  }
  if (value.activityType !== "strength" && value.plannedSession !== undefined) {
    context.addIssue({ code: "custom", path: ["plannedSession"], message: "Only a strength session can be linked to a workout plan." });
  }
  if ((value.exercises?.reduce((total, exercise) => total + exercise.sets.length, 0) ?? 0) > 100) {
    context.addIssue({ code: "custom", path: ["exercises"], message: "A workout can contain at most 100 sets." });
  }
});

export const updateActivityLogRequestSchema = z.object({
  baseVersion: z.number().int().positive(),
  activityType: z.enum(["steps", "walk", "cardio", "strength", "other"]),
  occurredAt: isoDateTime,
  energyKind: activityEnergyKindSchema.optional(),
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
  steps: z.number().int().min(0).max(200000).nullable(),
  notes: z.string().trim().max(500).nullable(),
  workoutTitle: z.string().trim().min(1).max(100).optional(),
  exercises: z.array(workoutExerciseSchema).min(1).max(20).optional(),
  plannedSession: plannedWorkoutSessionReferenceSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.durationMinutes === null && value.steps === null && !(value.activityType === "strength" && value.exercises?.length)) {
    context.addIssue({ code: "custom", path: ["durationMinutes"], message: "Enter a duration or step count." });
  }
  if (value.activityType === "steps" && value.steps === null) {
    context.addIssue({ code: "custom", path: ["steps"], message: "Enter a step count for a steps entry." });
  }
  if (value.activityType === "strength" && ((value.workoutTitle === undefined) !== (value.exercises === undefined) || (value.workoutTitle !== undefined && !value.exercises?.length))) {
    context.addIssue({ code: "custom", path: ["exercises"], message: "Provide both a workout name and at least one exercise with sets." });
  }
  if (value.activityType !== "strength" && (value.workoutTitle !== undefined || value.exercises !== undefined)) {
    context.addIssue({ code: "custom", path: ["exercises"], message: "Strength details are only valid for a strength session." });
  }
  if (value.activityType !== "strength" && value.plannedSession !== undefined) {
    context.addIssue({ code: "custom", path: ["plannedSession"], message: "Only a strength session can be linked to a workout plan." });
  }
  if ((value.exercises?.reduce((total, exercise) => total + exercise.sets.length, 0) ?? 0) > 100) {
    context.addIssue({ code: "custom", path: ["exercises"], message: "A workout can contain at most 100 sets." });
  }
});

export const deleteActivityLogRequestSchema = z.object({
  baseVersion: z.number().int().positive(),
}).strict();

export const activityLogRecordSchema = z.object({
  activityType: z.enum(["steps", "walk", "cardio", "strength", "other"]),
  occurredAt: isoDateTime,
  energyKind: activityEnergyKindSchema.optional(),
  energyEstimate: activityEnergyEstimateSchema.nullable().optional(),
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
  steps: z.number().int().min(0).max(200000).nullable(),
  notes: z.string().max(500).nullable(),
  workoutTitle: z.string().trim().min(1).max(100).optional(),
  exercises: z.array(workoutExerciseSchema).min(1).max(20).optional(),
  plannedSession: plannedWorkoutSessionReferenceSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.activityType !== "strength" && value.plannedSession !== undefined) {
    context.addIssue({ code: "custom", path: ["plannedSession"], message: "Only a strength session can be linked to a workout plan." });
  }
  const setCount = value.exercises?.reduce((total, exercise) => total + exercise.sets.length, 0) ?? 0;
  if (setCount > 100) context.addIssue({ code: "custom", path: ["exercises"], message: "A workout can contain at most 100 sets." });
});

export const exerciseProgressQuerySchema = z.object({
  range: z.enum(["30d", "90d", "365d"]).default("90d"),
}).strict();

const exerciseProgressPointSchema = z.object({
  date: z.string().date(),
  sessions: z.number().int().positive(),
  setCount: z.number().int().positive(),
  bestSetReps: z.number().int().min(1).max(200).nullable(),
  bestLoadKg: z.number().finite().min(0).max(1000).nullable(),
  longestHoldSeconds: z.number().int().min(1).max(7200).nullable(),
}).strict();

export const exerciseProgressResponseSchema = z.object({
  exercise: z.object({
    id: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(100),
    trackingMode: z.enum(["reps", "time"]),
  }).strict(),
  timezone: z.string().min(1).max(80),
  rangeStart: z.string().date(),
  rangeEnd: z.string().date(),
  points: z.array(exerciseProgressPointSchema).max(366),
}).strict();

const weeklyProgressDaySchema = z.object({
  date: z.string().date(),
  foodLogCount: z.number().int().min(0),
  foodDayComplete: z.boolean(),
  caloriesLoggedKcal: z.number().finite().min(0).nullable(),
  proteinLoggedG: z.number().finite().min(0).nullable(),
  workoutSessions: z.number().int().min(0),
  steps: z.number().int().min(0).nullable(),
  measurementWeightKg: z.number().finite().min(25).max(400).nullable(),
  plannedWeightKg: z.number().finite().min(25).max(400).nullable(),
}).strict();

export const weeklyProgressReviewResponseSchema = z.object({
  timezone: z.string().min(1).max(80),
  startDate: z.string().date(),
  endDate: z.string().date(),
  dailyTargets: z.object({
    caloriesKcal: z.number().int().min(800).max(5000).nullable(),
    proteinG: z.number().finite().min(0).max(500).nullable(),
  }).strict(),
  days: z.array(weeklyProgressDaySchema).length(7),
  summary: z.object({
    completeFoodDays: z.number().int().min(0).max(7),
    foodDaysWithLogs: z.number().int().min(0).max(7),
    averageCaloriesOnCompleteDaysKcal: z.number().finite().min(0).nullable(),
    averageProteinOnCompleteDaysG: z.number().finite().min(0).nullable(),
    workoutDays: z.number().int().min(0).max(7),
    workoutSessions: z.number().int().min(0),
    stepDays: z.number().int().min(0).max(7),
    averageStepsOnLoggedDays: z.number().finite().min(0).nullable(),
    weighInDays: z.number().int().min(0).max(7),
    firstWeighInDate: z.string().date().nullable(),
    lastWeighInDate: z.string().date().nullable(),
    recordedWeightChangeKg: z.number().finite().nullable(),
    latestPlanComparison: z.object({
      date: z.string().date(),
      measuredWeightKg: z.number().finite().min(25).max(400),
      plannedWeightKg: z.number().finite().min(25).max(400),
      differenceKg: z.number().finite(),
    }).strict().nullable(),
  }).strict(),
  trendReadiness: z.object({
    eligible: z.boolean(),
    measurementDays: z.number().int().min(0).max(28),
    spanDays: z.number().int().min(0).max(27),
    firstMeasurementDate: z.string().date().nullable(),
    lastMeasurementDate: z.string().date().nullable(),
    windowStartDate: z.string().date(),
    windowEndDate: z.string().date(),
    requiredMeasurementDays: z.literal(6),
    requiredSpanDays: z.literal(14),
  }).strict(),
}).strict();

export const dailyGoalEnergySchema = z.object({
  date: z.string().date(),
  checkIn: dailyCheckInSchema,
  checkInVersion: z.number().int().min(0),
  foodLogCount: z.number().int().min(0),
  proteinG: z.number().finite().min(0).nullable(),
  carbohydrateG: z.number().finite().min(0).nullable(),
  fatG: z.number().finite().min(0).nullable(),
  workoutSessions: z.number().int().min(0),
  weightReadings: z.number().int().min(0),
  steps: z.number().int().min(0).nullable(),
  goalVersion: z.number().int().positive().nullable(),
  targetCaloriesKcal: z.number().finite().nullable(),
  intakeCaloriesKcal: z.number().finite().min(0).nullable(),
  foodDayComplete: z.boolean(),
  activityCaloriesKcal: z.number().finite().min(0),
  activitiesMissingEnergy: z.number().int().min(0),
  baselineCaloriesKcal: z.number().finite().positive().nullable(),
  expenditureCaloriesKcal: z.number().finite().positive().nullable(),
  deficitCaloriesKcal: z.number().finite().nullable(),
  plannedDeficitCaloriesKcal: z.number().finite().nullable(),
  weightKg: z.number().finite().min(25).max(400).nullable(),
  weightSource: z.enum(["measurement", "accepted_baseline"]).nullable(),
  energyWeightKg: z.number().finite().min(25).max(400).nullable(),
  plannedWeightKg: z.number().finite().min(25).max(400).nullable(),
}).strict();

export const goalForecastSchema = z.object({
  status: z.enum(["collecting", "stale", "ready", "not_approaching", "at_goal", "maintenance", "outside_range"]),
  message: z.string().max(300),
  measuredDays: z.number().int().min(0).max(28),
  spanDays: z.number().int().min(0).max(27),
  weeklyChangeKg: z.number().finite().nullable(),
  arrivalDate: z.string().date().nullable(),
  earliestDate: z.string().date().nullable(),
  latestDate: z.string().date().nullable(),
  points: z.array(z.object({
    date: z.string().date(), weightKg: z.number().finite().min(25).max(400),
    lowKg: z.number().finite().min(25).max(400), highKg: z.number().finite().min(25).max(400),
  }).strict()).max(28),
}).strict();

export const progressOverviewResponseSchema = z.object({
  policyVersion: z.literal("progress-budget-v1"),
  timezone: z.string(),
  today: z.string().date(),
  goalVersion: z.number().int().positive(),
  currentWeightKg: z.number().finite().min(25).max(400),
  currentWeightDate: z.string().date(),
  progressKg: z.number().finite(),
  remainingKg: z.number().finite().min(0),
  progressPercent: z.number().finite().min(0).max(100),
  plannedWeeklyChangeKg: z.number().finite(),
  todayEnergy: dailyGoalEnergySchema,
  days: z.array(dailyGoalEnergySchema).max(731),
  forecast: goalForecastSchema,
  weekly: z.object({
    completeFoodDays: z.number().int().min(0).max(7),
    energyDays: z.number().int().min(0).max(7),
    averageIntakeKcal: z.number().finite().min(0).nullable(),
    averageDeficitKcal: z.number().finite().nullable(),
    recordedDeficitKcal: z.number().finite().nullable(),
    plannedDeficitForRecordedDaysKcal: z.number().finite().nullable(),
    activityCaloriesKcal: z.number().finite().min(0),
    message: z.string().max(300),
  }).strict(),
  milestones: z.array(z.object({ percent: z.number(), weightKg: z.number(), reached: z.boolean() }).strict()).max(4),
}).strict();

const workoutPlanExerciseSchema = z.object({
  exerciseId: z.string().trim().min(1).max(80),
  sets: z.number().int().min(1).max(20),
  trackingMode: z.enum(["reps", "time"]),
  targetMin: z.number().int().min(1),
  targetMax: z.number().int().min(1),
  restSeconds: z.number().int().min(0).max(900),
  targetLoadKg: z.number().finite().min(0).max(1000).nullable(),
}).strict().superRefine((value, context) => {
  if (value.targetMax < value.targetMin) {
    context.addIssue({ code: "custom", path: ["targetMax"], message: "The upper target must be at least the lower target." });
  }
  const maxTarget = value.trackingMode === "time" ? 7200 : 200;
  if (value.targetMax > maxTarget) {
    context.addIssue({ code: "custom", path: ["targetMax"], message: "The target is above the supported limit." });
  }
  if (value.trackingMode === "time" && value.targetLoadKg !== null) {
    context.addIssue({ code: "custom", path: ["targetLoadKg"], message: "Timed holds cannot have a load target." });
  }
});

const workoutPlanSessionSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  location: z.enum(["gym", "home"]).default("home"),
  label: z.string().trim().min(1).max(80),
  estimatedMinutes: z.number().int().min(5).max(240),
  exercises: z.array(workoutPlanExerciseSchema).min(1).max(20),
}).strict();

export const workoutPlanDataSchema = z.object({
  name: z.string().trim().min(1).max(80),
  focus: z.string().trim().min(1).max(180),
  sessions: z.array(workoutPlanSessionSchema).min(1).max(7),
}).strict().superRefine((value, context) => {
  const weekdays = value.sessions.map((session) => session.weekday);
  if (new Set(weekdays).size !== weekdays.length) {
    context.addIssue({ code: "custom", path: ["sessions"], message: "Schedule each workout on a different day." });
  }
  const weeklySets = value.sessions.reduce((total, session) => total + session.exercises.reduce((sum, exercise) => sum + exercise.sets, 0), 0);
  if (weeklySets > 300) {
    context.addIssue({ code: "custom", path: ["sessions"], message: "A weekly plan can contain at most 300 work sets." });
  }
});

export const workoutPlanModelOutputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  focus: z.string().trim().min(1).max(180),
  sessions: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    location: z.enum(["gym", "home"]),
    label: z.string().trim().min(1).max(80),
    exercises: z.array(z.object({
      exerciseId: z.string().trim().min(1).max(80),
      sets: z.number().int().min(1).max(20),
      trackingMode: z.enum(["reps", "time"]),
      targetMin: z.number().int().min(1).max(7200),
      targetMax: z.number().int().min(1).max(7200),
      restSeconds: z.number().int().min(0).max(900),
    }).strict()).min(1).max(12),
  }).strict()).min(1).max(7),
}).strict();

export const workoutPlanRunRequestSchema = z.object({
  idempotencyKey: uuidSchema,
}).strict();

export const createWorkoutPlanRequestSchema = z.object({
  planId: uuidSchema,
  groupId: uuidSchema,
  source: z.enum(["template", "manual"]),
  data: workoutPlanDataSchema,
}).strict();

export const updateWorkoutPlanRequestSchema = z.object({
  baseEditVersion: z.number().int().positive(),
  data: workoutPlanDataSchema,
}).strict();

export const approveWorkoutPlanRequestSchema = z.object({
  baseEditVersion: z.number().int().positive(),
}).strict();

export const workoutPlanVersionSchema = z.object({
  id: uuidSchema,
  groupId: uuidSchema,
  kind: z.literal("workout"),
  version: z.number().int().positive(),
  editVersion: z.number().int().positive(),
  status: z.enum(["draft", "active", "superseded", "archived"]),
  source: z.enum(["template", "manual", "ai"]),
  data: workoutPlanDataSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  approvedAt: isoDateTime.nullable(),
}).strict();

export const workoutPlansResponseSchema = z.object({
  plans: z.array(workoutPlanVersionSchema).max(100),
}).strict();

const mealPlanModelItemSchema = z.object({
  foodId: uuidSchema,
  quantityGrams: z.number().finite().positive().max(1500),
}).strict();

const mealPlanModelMealSchema = z.object({
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  items: z.array(mealPlanModelItemSchema).min(1).max(6),
  note: z.string().trim().max(180).nullable(),
}).strict();

export const mealPlanModelOutputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  days: z.array(z.object({
    date: z.string().date(),
    meals: z.array(mealPlanModelMealSchema).min(2).max(6),
  }).strict()).length(7),
}).strict();

const mealPlanItemSchema = z.object({
  foodId: uuidSchema,
  foodSource: z.enum(["shared_catalog", "personal"]),
  foodName: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(48),
  quantityGrams: z.number().finite().positive().max(1500),
  nutritionPer100g: nutritionSnapshotSchema,
  nutritionTotal: nutritionSnapshotSchema,
}).strict();

const mealPlanMealSchema = z.object({
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  items: z.array(mealPlanItemSchema).min(1).max(6),
  note: z.string().max(180).nullable(),
}).strict();

const mealPlanDaySchema = z.object({
  date: z.string().date(),
  meals: z.array(mealPlanMealSchema).min(2).max(6),
  totals: nutritionSnapshotSchema,
}).strict();

export const mealPlanDataSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startDate: z.string().date(),
  dailyCalorieTargetKcal: z.number().int().min(800).max(5000),
  macroTargetsGrams: z.object({
    proteinG: z.number().finite().min(0).max(500),
    carbohydrateG: z.number().finite().min(0).max(1000),
    fatG: z.number().finite().min(0).max(500),
  }).strict().nullable(),
  days: z.array(mealPlanDaySchema).length(7),
}).strict().superRefine((value, context) => {
  const seenDates = new Set<string>();
  for (let index = 0; index < value.days.length; index += 1) {
    const day = value.days[index]!;
    const expected = new Date(Date.parse(`${value.startDate}T00:00:00.000Z`) + index * 86_400_000)
      .toISOString().slice(0, 10);
    if (day.date !== expected || seenDates.has(day.date)) {
      context.addIssue({ code: "custom", path: ["days", index, "date"], message: "Meal plan dates must be seven consecutive unique days." });
    }
    seenDates.add(day.date);
    const mealTypes = day.meals.map((meal) => meal.mealType).filter((type) => type !== "snack");
    if (new Set(mealTypes).size !== mealTypes.length) {
      context.addIssue({ code: "custom", path: ["days", index, "meals"], message: "A day can include each main meal once." });
    }
    const lower = value.dailyCalorieTargetKcal * 0.8;
    const upper = value.dailyCalorieTargetKcal * 1.2;
    if (day.totals.caloriesKcal < lower || day.totals.caloriesKcal > upper) {
      context.addIssue({ code: "custom", path: ["days", index, "totals", "caloriesKcal"], message: "Daily calories must remain within 20% of the accepted target." });
    }
    if (value.macroTargetsGrams) {
      const macros = [
        ["proteinG", value.macroTargetsGrams.proteinG],
        ["carbohydrateG", value.macroTargetsGrams.carbohydrateG],
        ["fatG", value.macroTargetsGrams.fatG],
      ] as const;
      for (const [key, target] of macros) {
        if (target > 0 && (day.totals[key] < target * 0.7 || day.totals[key] > target * 1.3)) {
          context.addIssue({ code: "custom", path: ["days", index, "totals", key], message: "Daily macros must remain within 30% of the accepted target." });
        }
      }
    }
  }
});

export const mealPlanEditRequestSchema = z.object({
  baseEditVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(80),
  startDate: z.string().date(),
  days: z.array(z.object({
    date: z.string().date(),
    meals: z.array(z.object({
      mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
      items: z.array(z.object({
        foodId: uuidSchema,
        foodSource: z.enum(["shared_catalog", "personal"]),
        quantityGrams: z.number().finite().positive().max(1500),
      }).strict()).min(1).max(6),
      note: z.string().trim().max(180).nullable(),
    }).strict()).min(2).max(6),
  }).strict()).length(7),
}).strict();

export const mealPlanRunRequestSchema = z.object({
  idempotencyKey: uuidSchema,
  startDate: z.string().date(),
}).strict();

export const approveMealPlanRequestSchema = z.object({
  baseEditVersion: z.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
}).strict();

export const mealPlanVersionSchema = z.object({
  id: uuidSchema,
  groupId: uuidSchema,
  kind: z.literal("meal"),
  version: z.number().int().positive(),
  editVersion: z.number().int().positive(),
  status: z.enum(["draft", "active", "superseded", "archived"]),
  source: z.enum(["template", "manual", "ai"]),
  data: mealPlanDataSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  approvedAt: isoDateTime.nullable(),
}).strict();

export const mealPlansResponseSchema = z.object({
  plans: z.array(mealPlanVersionSchema).max(100),
}).strict();

export const aiRunResponseSchema = z.object({
  id: uuidSchema,
  kind: z.enum(["meal_plan", "workout_plan"]),
  status: z.enum(["running", "pending_review", "completed", "failed", "rejected", "stale"]),
  planId: uuidSchema.nullable(),
  errorCode: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
}).strict();

const bodyMeasurementSchema = z.object({
  measuredAt: isoDateTime,
  weightKg: z.number().finite().min(25).max(400),
}).strict();

const upsertOperation = <TEntity extends string, T extends z.ZodTypeAny>(entity: TEntity, data: T) => z.object({
  entity: z.literal(entity),
  id: uuidSchema,
  operation: z.literal("upsert"),
  baseVersion: z.number().int().nonnegative().nullable(),
  data,
}).strict();

const deleteOperation = <TEntity extends string>(entity: TEntity) => z.object({
  entity: z.literal(entity),
  id: uuidSchema,
  operation: z.literal("delete"),
  baseVersion: z.number().int().positive(),
}).strict();

export const syncOperationSchema = z.union([
  upsertOperation("food_log", foodLogSchema),
  deleteOperation("food_log"),
  upsertOperation("activity_log", activityLogSchema),
  deleteOperation("activity_log"),
  upsertOperation("body_measurement", bodyMeasurementSchema),
  deleteOperation("body_measurement"),
  upsertOperation("goal", goalSchema),
  deleteOperation("goal"),
]);

export const syncPushSchema = z.object({
  idempotencyKey: uuidSchema,
  operations: z.array(syncOperationSchema).min(1).max(100),
}).strict();

export const syncPullQuerySchema = z.object({
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).strict();

export type Profile = z.infer<typeof profileSchema>;
export type FoodPreferences = z.infer<typeof foodPreferencesSchema>;
export type ReminderPreferences = z.infer<typeof reminderPreferencesResponseSchema>;
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
export type SetFoodFavoriteRequest = z.infer<typeof setFoodFavoriteRequestSchema>;
export type CreateFoodPortionRequest = z.infer<typeof createFoodPortionRequestSchema>;
export type GoalProposalRequest = z.infer<typeof goalProposalRequestSchema>;
export type GoalRecord = z.infer<typeof goalSchema>;
export type DailyGoalEnergy = z.infer<typeof dailyGoalEnergySchema>;
export type GoalForecast = z.infer<typeof goalForecastSchema>;
export type ProgressOverview = z.infer<typeof progressOverviewResponseSchema>;
export type CreateFoodLogRequest = z.infer<typeof createFoodLogRequestSchema>;
export type CopyFoodLogsRequest = z.infer<typeof copyFoodLogsRequestSchema>;
export type FoodPhotoRecognitionRequest = z.infer<typeof foodPhotoRecognitionRequestSchema>;
export type FoodPhotoRecognitionResponse = z.infer<typeof foodPhotoRecognitionResponseSchema>;
export type FoodTextEstimateRequest = z.infer<typeof foodTextEstimateRequestSchema>;
export type FoodPhotoEstimate = z.infer<typeof foodPhotoEstimateSchema>;
export type ConfirmFoodPhotoRequest = z.infer<typeof confirmFoodPhotoRequestSchema>;
export type UpdateFoodLogRequest = z.infer<typeof updateFoodLogRequestSchema>;
export type FoodDayStatusRequest = z.infer<typeof foodDayStatusRequestSchema>;
export type CreateCustomFoodRequest = z.infer<typeof createCustomFoodRequestSchema>;
export type CreateFoodRecipeRequest = z.infer<typeof createFoodRecipeRequestSchema>;
export type UpdateFoodRecipeRequest = z.infer<typeof updateFoodRecipeRequestSchema>;
export type FoodLogRecord = z.infer<typeof foodLogRecordSchema>;
export type CreateActivityLogRequest = z.infer<typeof createActivityLogRequestSchema>;
export type UpdateActivityLogRequest = z.infer<typeof updateActivityLogRequestSchema>;
export type DeleteActivityLogRequest = z.infer<typeof deleteActivityLogRequestSchema>;
export type ActivityLogRecord = z.infer<typeof activityLogRecordSchema>;
export type ActivityEnergyKind = z.infer<typeof activityEnergyKindSchema>;
export type ActivityEnergyEstimate = z.infer<typeof activityEnergyEstimateSchema>;
export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;
export type WorkoutSet = z.infer<typeof workoutSetSchema>;
export type ExerciseProgressQuery = z.infer<typeof exerciseProgressQuerySchema>;
export type ExerciseProgressResponse = z.infer<typeof exerciseProgressResponseSchema>;
export type WeeklyProgressReviewResponse = z.infer<typeof weeklyProgressReviewResponseSchema>;
export type WorkoutPlanData = z.infer<typeof workoutPlanDataSchema>;
export type WorkoutPlanSession = WorkoutPlanData["sessions"][number];
export type WorkoutPlanVersion = z.infer<typeof workoutPlanVersionSchema>;
export type WorkoutPlanModelOutput = z.infer<typeof workoutPlanModelOutputSchema>;
export type WorkoutPlanRunRequest = z.infer<typeof workoutPlanRunRequestSchema>;
export type MealPlanData = z.infer<typeof mealPlanDataSchema>;
export type MealPlanDay = MealPlanData["days"][number];
export type MealPlanEditRequest = z.infer<typeof mealPlanEditRequestSchema>;
export type MealPlanVersion = z.infer<typeof mealPlanVersionSchema>;
export type SyncOperation = z.infer<typeof syncOperationSchema>;
export type SyncPushRequest = z.infer<typeof syncPushSchema>;
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;
