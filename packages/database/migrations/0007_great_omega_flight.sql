ALTER TYPE "public"."plan_kind" ADD VALUE 'meal' BEFORE 'workout';--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"input_snapshot" jsonb NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"result_plan_id" uuid,
	"input_tokens" integer,
	"output_tokens" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_runs_kind_valid" CHECK ("ai_runs"."kind" IN ('meal_plan', 'workout_plan')),
	CONSTRAINT "ai_runs_status_valid" CHECK ("ai_runs"."status" IN ('running', 'pending_review', 'completed', 'failed', 'rejected', 'stale')),
	CONSTRAINT "ai_runs_usage_nonnegative" CHECK (("ai_runs"."input_tokens" IS NULL OR "ai_runs"."input_tokens" >= 0) AND ("ai_runs"."output_tokens" IS NULL OR "ai_runs"."output_tokens" >= 0))
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_owner_kind_idempotency_idx" ON "ai_runs" USING btree ("user_id","kind","idempotency_key");--> statement-breakpoint
CREATE INDEX "ai_runs_owner_created_idx" ON "ai_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE POLICY "ai_runs_owner_policy" ON "ai_runs" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));