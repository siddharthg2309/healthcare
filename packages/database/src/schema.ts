import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  numeric,
} from "drizzle-orm/pg-core";

export const recordEntity = pgEnum("record_entity", [
  "food_log",
  "activity_log",
  "body_measurement",
  "goal",
]);

export const planKind = pgEnum("plan_kind", ["meal", "workout"]);
export const planStatus = pgEnum("plan_status", ["draft", "active", "superseded", "archived"]);

export const userProfiles = pgTable("user_profiles", {
  userId: text("user_id").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, () => [
  pgPolicy("user_profiles_owner_policy", {
    for: "all",
    to: "public",
    using: sql`user_id = current_setting('app.user_id', true)`,
    withCheck: sql`user_id = current_setting('app.user_id', true)`,
  }),
]).enableRLS();

// Each row is an immutable approved version or an editable draft snapshot.
// Session and exercise details stay together so a version can be copied and
// reviewed as one validated document.
export const plans = pgTable("plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  groupId: uuid("group_id").notNull(),
  kind: planKind("kind").default("workout").notNull(),
  version: integer("version").notNull(),
  editVersion: integer("edit_version").default(1).notNull(),
  status: planStatus("status").default("draft").notNull(),
  source: text("source").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("plans_owner_group_version_idx").on(table.userId, table.groupId, table.version),
  uniqueIndex("plans_owner_active_group_idx").on(table.userId, table.groupId).where(sql`${table.status} = 'active'`),
  uniqueIndex("plans_owner_draft_group_idx").on(table.userId, table.groupId).where(sql`${table.status} = 'draft'`),
  index("plans_owner_updated_idx").on(table.userId, table.updatedAt),
  check("plans_version_positive", sql`${table.version} > 0 AND ${table.editVersion} > 0`),
  check("plans_source_valid", sql`${table.source} IN ('template', 'manual', 'ai')`),
  pgPolicy("plans_owner_policy", {
    for: "all",
    to: "public",
    using: sql`user_id = current_setting('app.user_id', true)`,
    withCheck: sql`user_id = current_setting('app.user_id', true)`,
  }),
]).enableRLS();

export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").default("running").notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(),
  inputHash: text("input_hash").notNull(),
  inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  schemaVersion: text("schema_version").notNull(),
  resultPlanId: uuid("result_plan_id"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ai_runs_owner_kind_idempotency_idx").on(table.userId, table.kind, table.idempotencyKey),
  index("ai_runs_owner_created_idx").on(table.userId, table.createdAt),
  check("ai_runs_kind_valid", sql`${table.kind} IN ('meal_plan', 'workout_plan')`),
  check("ai_runs_status_valid", sql`${table.status} IN ('running', 'pending_review', 'completed', 'failed', 'rejected', 'stale')`),
  check("ai_runs_usage_nonnegative", sql`(${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0) AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0)`),
  pgPolicy("ai_runs_owner_policy", {
    for: "all",
    to: "public",
    using: sql`user_id = current_setting('app.user_id', true)`,
    withCheck: sql`user_id = current_setting('app.user_id', true)`,
  }),
]).enableRLS();

export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  redeemedBy: text("redeemed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("invitations_email_idx").on(table.email)]);

export const catalogFoods = pgTable("catalog_foods", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  caloriesKcalPer100g: numeric("calories_kcal_per_100g", { precision: 9, scale: 2 }).notNull(),
  proteinGPer100g: numeric("protein_g_per_100g", { precision: 8, scale: 2 }).notNull(),
  carbohydrateGPer100g: numeric("carbohydrate_g_per_100g", { precision: 8, scale: 2 }).notNull(),
  fatGPer100g: numeric("fat_g_per_100g", { precision: 8, scale: 2 }).notNull(),
  source: text("source").notNull(),
  externalSourceId: text("external_source_id"),
  reviewed: boolean("reviewed").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("catalog_foods_name_idx").on(table.name),
  uniqueIndex("catalog_foods_source_record_idx").on(table.source, table.externalSourceId),
  check("catalog_foods_nutrition_nonnegative", sql`
    ${table.caloriesKcalPer100g} >= 0 AND ${table.proteinGPer100g} >= 0
    AND ${table.carbohydrateGPer100g} >= 0 AND ${table.fatGPer100g} >= 0
  `),
]);

export const userFoods = pgTable("user_foods", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  caloriesKcalPer100g: numeric("calories_kcal_per_100g", { precision: 9, scale: 2 }).notNull(),
  proteinGPer100g: numeric("protein_g_per_100g", { precision: 8, scale: 2 }).notNull(),
  carbohydrateGPer100g: numeric("carbohydrate_g_per_100g", { precision: 8, scale: 2 }).notNull(),
  fatGPer100g: numeric("fat_g_per_100g", { precision: 8, scale: 2 }).notNull(),
  sourceNote: text("source_note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("user_foods_owner_name_idx").on(table.userId, table.name),
  check("user_foods_nutrition_nonnegative", sql`
    ${table.caloriesKcalPer100g} >= 0 AND ${table.proteinGPer100g} >= 0
    AND ${table.carbohydrateGPer100g} >= 0 AND ${table.fatGPer100g} >= 0
  `),
  pgPolicy("user_foods_owner_policy", {
    for: "all",
    to: "public",
    using: sql`user_id = current_setting('app.user_id', true)`,
    withCheck: sql`user_id = current_setting('app.user_id', true)`,
  }),
]).enableRLS();

export const foodDayStatuses = pgTable("food_day_statuses", {
  userId: text("user_id").notNull(),
  localDate: text("local_date").notNull(),
  complete: boolean("complete").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.localDate] }),
  check("food_day_status_local_date_format", sql`${table.localDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
  pgPolicy("food_day_status_owner_policy", {
    for: "all",
    to: "public",
    using: sql`user_id = current_setting('app.user_id', true)`,
    withCheck: sql`user_id = current_setting('app.user_id', true)`,
  }),
]).enableRLS();

export const userRecords = pgTable("user_records", {
  userId: text("user_id").notNull(),
  entity: recordEntity("entity").notNull(),
  recordId: uuid("record_id").notNull(),
  version: integer("version").notNull(),
  data: jsonb("data").$type<Record<string, unknown> | null>(),
  deleted: boolean("deleted").default(false).notNull(),
  clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true }),
  serverUpdatedAt: timestamp("server_updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.entity, table.recordId] }),
  index("user_records_updated_idx").on(table.userId, table.serverUpdatedAt),
  pgPolicy("user_records_owner_policy", {
    for: "all",
    to: "public",
    using: sql`user_id = current_setting('app.user_id', true)`,
    withCheck: sql`user_id = current_setting('app.user_id', true)`,
  }),
]).enableRLS();

export const userSyncCounters = pgTable("user_sync_counters", {
  userId: text("user_id").primaryKey(),
  cursor: integer("cursor").default(0).notNull(),
}, () => [
  pgPolicy("user_sync_counters_owner_policy", {
    for: "all",
    to: "public",
    using: sql`user_id = current_setting('app.user_id', true)`,
    withCheck: sql`user_id = current_setting('app.user_id', true)`,
  }),
]).enableRLS();

export const syncRequests = pgTable("sync_requests", {
  userId: text("user_id").notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(),
  response: jsonb("response").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.idempotencyKey] }),
  index("sync_requests_created_idx").on(table.createdAt),
  pgPolicy("sync_requests_owner_policy", {
    for: "all",
    to: "public",
    using: sql`user_id = current_setting('app.user_id', true)`,
    withCheck: sql`user_id = current_setting('app.user_id', true)`,
  }),
]).enableRLS();

export const syncChanges = pgTable("sync_changes", {
  userId: text("user_id").notNull(),
  cursor: integer("cursor").notNull(),
  entity: recordEntity("entity").notNull(),
  recordId: uuid("record_id").notNull(),
  version: integer("version").notNull(),
  data: jsonb("data").$type<Record<string, unknown> | null>(),
  deleted: boolean("deleted").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.cursor] }),
  index("sync_changes_created_idx").on(table.userId, table.createdAt),
  pgPolicy("sync_changes_owner_policy", {
    for: "all",
    to: "public",
    using: sql`user_id = current_setting('app.user_id', true)`,
    withCheck: sql`user_id = current_setting('app.user_id', true)`,
  }),
]).enableRLS();

export const privateUploads = pgTable("private_uploads", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  objectKey: text("object_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("private_uploads_owner_idx").on(table.userId, table.id),
  check("private_uploads_size_positive", sql`${table.byteSize} > 0 AND ${table.byteSize} <= 10485760`),
  pgPolicy("private_uploads_owner_policy", {
    for: "all",
    to: "public",
    using: sql`user_id = current_setting('app.user_id', true)`,
    withCheck: sql`user_id = current_setting('app.user_id', true)`,
  }),
]).enableRLS();

export const jobQueue = pgTable("job_queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id"),
  kind: text("kind").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").default("pending").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(4).notNull(),
  availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  idempotencyKey: text("idempotency_key"),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("job_queue_claim_idx").on(table.status, table.availableAt),
  uniqueIndex("job_queue_idempotency_idx").on(table.userId, table.idempotencyKey),
  check("job_queue_status_valid", sql`${table.status} IN ('pending', 'leased', 'completed', 'failed')`),
  check("job_queue_attempts_valid", sql`${table.attempts} >= 0 AND ${table.maxAttempts} > 0 AND ${table.attempts} <= ${table.maxAttempts}`),
  pgPolicy("job_queue_worker_policy", {
    for: "all",
    to: "public",
    using: sql`current_setting('app.worker_access', true) = 'true'`,
    withCheck: sql`current_setting('app.worker_access', true) = 'true'`,
  }),
]).enableRLS();

export type CatalogFood = typeof catalogFoods.$inferSelect;
export type UserRecord = typeof userRecords.$inferSelect;
