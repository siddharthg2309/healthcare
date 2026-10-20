CREATE TABLE "food_day_statuses" (
	"user_id" text NOT NULL,
	"local_date" text NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_day_statuses_user_id_local_date_pk" PRIMARY KEY("user_id","local_date"),
	CONSTRAINT "food_day_status_local_date_format" CHECK ("food_day_statuses"."local_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "food_day_statuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "food_day_status_owner_policy" ON "food_day_statuses" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));