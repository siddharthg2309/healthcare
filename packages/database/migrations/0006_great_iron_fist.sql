CREATE TYPE "public"."plan_kind" AS ENUM('workout');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'active', 'superseded', 'archived');--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" "plan_kind" DEFAULT 'workout' NOT NULL,
	"version" integer NOT NULL,
	"edit_version" integer DEFAULT 1 NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"source" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	CONSTRAINT "plans_version_positive" CHECK ("plans"."version" > 0 AND "plans"."edit_version" > 0),
	CONSTRAINT "plans_source_valid" CHECK ("plans"."source" IN ('template', 'manual', 'ai'))
);
--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_owner_group_version_idx" ON "plans" USING btree ("user_id","group_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_owner_active_group_idx" ON "plans" USING btree ("user_id","group_id") WHERE "plans"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "plans_owner_draft_group_idx" ON "plans" USING btree ("user_id","group_id") WHERE "plans"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "plans_owner_updated_idx" ON "plans" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE POLICY "plans_owner_policy" ON "plans" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));