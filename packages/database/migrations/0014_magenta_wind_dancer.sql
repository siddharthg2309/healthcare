CREATE TABLE "user_food_recipe_versions" (
	"user_id" text NOT NULL,
	"food_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_food_recipe_versions_user_id_food_id_version_pk" PRIMARY KEY("user_id","food_id","version"),
	CONSTRAINT "user_food_recipe_versions_version_positive" CHECK ("user_food_recipe_versions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "user_food_recipe_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_foods" ADD COLUMN "recipe_version" integer;--> statement-breakpoint
ALTER TABLE "user_food_recipe_versions" ADD CONSTRAINT "user_food_recipe_versions_food_id_user_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."user_foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_food_recipe_versions_owner_food_idx" ON "user_food_recipe_versions" USING btree ("user_id","food_id");--> statement-breakpoint
CREATE POLICY "user_food_recipe_versions_owner_policy" ON "user_food_recipe_versions" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
UPDATE "user_foods"
SET "recipe_version" = 1,
    "recipe" = jsonb_set("recipe", '{instructions}', '[]'::jsonb, true)
WHERE "recipe" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "user_food_recipe_versions" (
  "user_id", "food_id", "version", "snapshot"
)
SELECT
  "user_id",
  "id",
  1,
  jsonb_build_object(
    'name', "name",
    'aliases', to_jsonb("aliases"),
    'category', "category",
    'caloriesKcalPer100g', "calories_kcal_per_100g",
    'proteinGPer100g', "protein_g_per_100g",
    'carbohydrateGPer100g', "carbohydrate_g_per_100g",
    'fatGPer100g', "fat_g_per_100g",
    'sourceNote', "source_note",
    'recipe', "recipe"
  )
FROM "user_foods"
WHERE "recipe" IS NOT NULL;
