CREATE TABLE "user_foods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"calories_kcal_per_100g" numeric(9, 2) NOT NULL,
	"protein_g_per_100g" numeric(8, 2) NOT NULL,
	"carbohydrate_g_per_100g" numeric(8, 2) NOT NULL,
	"fat_g_per_100g" numeric(8, 2) NOT NULL,
	"source_note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_foods_nutrition_nonnegative" CHECK (
    "user_foods"."calories_kcal_per_100g" >= 0 AND "user_foods"."protein_g_per_100g" >= 0
    AND "user_foods"."carbohydrate_g_per_100g" >= 0 AND "user_foods"."fat_g_per_100g" >= 0
  )
);
--> statement-breakpoint
ALTER TABLE "user_foods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "user_foods_owner_name_idx" ON "user_foods" USING btree ("user_id","name");--> statement-breakpoint
CREATE POLICY "user_foods_owner_policy" ON "user_foods" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));