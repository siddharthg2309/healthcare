import { z } from "zod";

const uuidSchema = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });

export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  ageYears: z.number().int().min(13).max(110),
  heightCm: z.number().min(80).max(250),
  currentWeightKg: z.number().min(25).max(400),
  unitSystem: z.enum(["metric", "imperial"]),
  energyEquation: z.enum(["mifflin_female", "mifflin_male", "manual", "not_provided"]),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  timezone: z.string().min(1).max(80),
  dietaryPreferences: z.array(z.string().trim().min(1).max(48)).max(30),
  restrictions: z.array(z.string().trim().min(1).max(80)).max(50),
  equipment: z.array(z.string().trim().min(1).max(80)).max(50),
  availableWorkoutDays: z.number().int().min(0).max(7),
  pregnancyOrBreastfeeding: z.boolean(),
  clinicianDirectedDiet: z.boolean(),
}).strict();

export const goalProposalRequestSchema = z.object({
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

export const goalSchema = z.object({
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
  calculationMode: z.enum(["automatic_estimate", "manual_target"]),
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
  occurredAt: isoDateTime,
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  quantityGrams: z.number().finite().positive().max(5000),
}).strict();

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

export const createCustomFoodRequestSchema = z.object({
  foodId: uuidSchema,
  name: z.string().trim().min(1).max(120),
  category: z.enum(["ingredient", "prepared_meal", "snack", "beverage", "restaurant", "other"]),
  caloriesKcalPer100g: z.number().finite().min(0).max(1000),
  proteinGPer100g: z.number().finite().min(0).max(100),
  carbohydrateGPer100g: z.number().finite().min(0).max(100),
  fatGPer100g: z.number().finite().min(0).max(100),
  sourceNote: z.string().trim().min(1).max(160),
}).strict();

export const nutritionSnapshotSchema = z.object({
  caloriesKcal: z.number().finite().min(0),
  proteinG: z.number().finite().min(0),
  carbohydrateG: z.number().finite().min(0),
  fatG: z.number().finite().min(0),
}).strict();

export const foodLogRecordSchema = z.object({
  foodId: uuidSchema,
  foodSource: z.enum(["shared_catalog", "personal"]),
  foodName: z.string().min(1).max(120),
  category: z.string().min(1).max(48),
  occurredAt: isoDateTime,
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  quantityGrams: z.number().finite().positive().max(5000),
  nutritionPer100g: nutritionSnapshotSchema,
  nutritionTotal: nutritionSnapshotSchema,
}).strict();

const workoutSetSchema = z.object({
  reps: z.number().int().min(1).max(200),
  loadKg: z.number().finite().min(0).max(1000).nullable(),
}).strict();

const workoutExerciseSchema = z.object({
  exerciseId: z.string().trim().min(1).max(80).nullable().optional(),
  exerciseName: z.string().trim().min(1).max(100),
  sets: z.array(workoutSetSchema).min(1).max(20),
}).strict();

const activityLogSchema = z.object({
  activityType: z.enum(["steps", "walk", "cardio", "strength", "other"]),
  occurredAt: isoDateTime,
  durationMinutes: z.number().int().min(0).max(1440).nullable(),
  steps: z.number().int().min(0).max(200000).nullable(),
  notes: z.string().trim().max(500).nullable(),
  workoutTitle: z.string().trim().min(1).max(100).optional(),
  exercises: z.array(workoutExerciseSchema).min(1).max(20).optional(),
}).strict().superRefine((value, context) => {
  const setCount = value.exercises?.reduce((total, exercise) => total + exercise.sets.length, 0) ?? 0;
  if (setCount > 100) context.addIssue({ code: "custom", path: ["exercises"], message: "A workout can contain at most 100 sets." });
});

export const createActivityLogRequestSchema = z.object({
  activityId: uuidSchema,
  activityType: z.enum(["steps", "walk", "cardio", "strength", "other"]),
  occurredAt: isoDateTime,
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
  steps: z.number().int().min(0).max(200000).nullable(),
  notes: z.string().trim().max(500).nullable(),
  workoutTitle: z.string().trim().min(1).max(100).optional(),
  exercises: z.array(workoutExerciseSchema).min(1).max(20).optional(),
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
  if ((value.exercises?.reduce((total, exercise) => total + exercise.sets.length, 0) ?? 0) > 100) {
    context.addIssue({ code: "custom", path: ["exercises"], message: "A workout can contain at most 100 sets." });
  }
});

export const updateActivityLogRequestSchema = z.object({
  baseVersion: z.number().int().positive(),
  activityType: z.enum(["steps", "walk", "cardio", "strength", "other"]),
  occurredAt: isoDateTime,
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
  steps: z.number().int().min(0).max(200000).nullable(),
  notes: z.string().trim().max(500).nullable(),
  workoutTitle: z.string().trim().min(1).max(100).optional(),
  exercises: z.array(workoutExerciseSchema).min(1).max(20).optional(),
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
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
  steps: z.number().int().min(0).max(200000).nullable(),
  notes: z.string().max(500).nullable(),
  workoutTitle: z.string().trim().min(1).max(100).optional(),
  exercises: z.array(workoutExerciseSchema).min(1).max(20).optional(),
}).strict().superRefine((value, context) => {
  const setCount = value.exercises?.reduce((total, exercise) => total + exercise.sets.length, 0) ?? 0;
  if (setCount > 100) context.addIssue({ code: "custom", path: ["exercises"], message: "A workout can contain at most 100 sets." });
});

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
export type GoalProposalRequest = z.infer<typeof goalProposalRequestSchema>;
export type GoalRecord = z.infer<typeof goalSchema>;
export type CreateFoodLogRequest = z.infer<typeof createFoodLogRequestSchema>;
export type UpdateFoodLogRequest = z.infer<typeof updateFoodLogRequestSchema>;
export type FoodDayStatusRequest = z.infer<typeof foodDayStatusRequestSchema>;
export type CreateCustomFoodRequest = z.infer<typeof createCustomFoodRequestSchema>;
export type FoodLogRecord = z.infer<typeof foodLogRecordSchema>;
export type CreateActivityLogRequest = z.infer<typeof createActivityLogRequestSchema>;
export type UpdateActivityLogRequest = z.infer<typeof updateActivityLogRequestSchema>;
export type DeleteActivityLogRequest = z.infer<typeof deleteActivityLogRequestSchema>;
export type ActivityLogRecord = z.infer<typeof activityLogRecordSchema>;
export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;
export type WorkoutSet = z.infer<typeof workoutSetSchema>;
export type SyncOperation = z.infer<typeof syncOperationSchema>;
export type SyncPushRequest = z.infer<typeof syncPushSchema>;
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;
