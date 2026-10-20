import { z } from "zod";

const uuidSchema = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });

export const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  heightCm: z.number().min(80).max(250),
  currentWeightKg: z.number().min(25).max(400),
  birthDate: z.string().date(),
  sexAtBirth: z.enum(["female", "male", "intersex", "unspecified"]),
  activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  timezone: z.string().min(1).max(80),
  dietaryPreferences: z.array(z.string().trim().min(1).max(48)).max(30),
  restrictions: z.array(z.string().trim().min(1).max(80)).max(50),
  equipment: z.array(z.string().trim().min(1).max(80)).max(50),
  availableWorkoutDays: z.number().int().min(0).max(7),
}).strict();

const foodLogSchema = z.object({
  catalogFoodId: uuidSchema,
  occurredAt: isoDateTime,
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  quantityGrams: z.number().finite().positive().max(5000),
}).strict();

const activityLogSchema = z.object({
  activityType: z.enum(["steps", "walk", "cardio", "strength", "other"]),
  occurredAt: isoDateTime,
  durationMinutes: z.number().int().min(0).max(1440).nullable(),
  steps: z.number().int().min(0).max(200000).nullable(),
  notes: z.string().trim().max(500).nullable(),
}).strict();

const bodyMeasurementSchema = z.object({
  measuredAt: isoDateTime,
  weightKg: z.number().finite().min(25).max(400),
}).strict();

const goalSchema = z.object({
  direction: z.enum(["lose", "gain", "maintain"]),
  targetWeightKg: z.number().finite().min(25).max(400),
  targetDate: z.string().date(),
  acceptedAt: isoDateTime,
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
export type SyncOperation = z.infer<typeof syncOperationSchema>;
export type SyncPushRequest = z.infer<typeof syncPushSchema>;
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;
