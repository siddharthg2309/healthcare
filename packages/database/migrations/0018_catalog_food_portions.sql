CREATE TABLE "catalog_food_portions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"food_id" uuid NOT NULL,
	"label" text NOT NULL,
	"grams" integer NOT NULL,
	"source_note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_food_portions_label_valid" CHECK (length(trim("catalog_food_portions"."label")) BETWEEN 1 AND 80),
	CONSTRAINT "catalog_food_portions_grams_valid" CHECK ("catalog_food_portions"."grams" BETWEEN 1 AND 5000),
	CONSTRAINT "catalog_food_portions_source_note_valid" CHECK (length(trim("catalog_food_portions"."source_note")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "catalog_food_portions" ADD CONSTRAINT "catalog_food_portions_food_id_catalog_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."catalog_foods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_food_portions_food_idx" ON "catalog_food_portions" USING btree ("food_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_food_portions_food_label_idx" ON "catalog_food_portions" USING btree ("food_id",lower("label"));