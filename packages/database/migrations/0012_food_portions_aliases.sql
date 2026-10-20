CREATE TABLE "food_portions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"food_source" text NOT NULL,
	"food_id" uuid NOT NULL,
	"label" text NOT NULL,
	"grams" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_portions_source_valid" CHECK ("food_portions"."food_source" IN ('shared_catalog', 'personal')),
	CONSTRAINT "food_portions_label_valid" CHECK (length(trim("food_portions"."label")) BETWEEN 1 AND 40),
	CONSTRAINT "food_portions_grams_valid" CHECK ("food_portions"."grams" BETWEEN 1 AND 5000)
);
--> statement-breakpoint
ALTER TABLE "food_portions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_foods" ADD COLUMN "aliases" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_foods" ADD COLUMN "aliases" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE INDEX "food_portions_owner_food_idx" ON "food_portions" USING btree ("user_id","food_source","food_id");--> statement-breakpoint
CREATE UNIQUE INDEX "food_portions_owner_food_label_idx" ON "food_portions" USING btree ("user_id","food_source","food_id",lower("label"));--> statement-breakpoint
CREATE POLICY "food_portions_owner_policy" ON "food_portions" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "food_portions" ADD CONSTRAINT "food_portions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "food_portions" FORCE ROW LEVEL SECURITY;
