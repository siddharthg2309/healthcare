CREATE TABLE "catalog_food_safety_reviews" (
	"food_id" uuid PRIMARY KEY NOT NULL,
	"dietary_tags" text[] DEFAULT '{}' NOT NULL,
	"contains_allergens" text[] DEFAULT '{}' NOT NULL,
	"may_contain_allergens" text[] DEFAULT '{}' NOT NULL,
	"source_note" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_food_safety_dietary_tags_valid" CHECK ("catalog_food_safety_reviews"."dietary_tags" <@ ARRAY['vegetarian', 'vegan', 'pescatarian', 'gluten_free', 'dairy_free']::text[]),
	CONSTRAINT "catalog_food_safety_contains_allergens_valid" CHECK ("catalog_food_safety_reviews"."contains_allergens" <@ ARRAY['celery', 'crustaceans', 'eggs', 'fish', 'gluten_cereals', 'lupin', 'milk', 'molluscs', 'mustard', 'peanuts', 'sesame', 'soybeans', 'sulphites', 'tree_nuts']::text[]),
	CONSTRAINT "catalog_food_safety_may_contain_allergens_valid" CHECK ("catalog_food_safety_reviews"."may_contain_allergens" <@ ARRAY['celery', 'crustaceans', 'eggs', 'fish', 'gluten_cereals', 'lupin', 'milk', 'molluscs', 'mustard', 'peanuts', 'sesame', 'soybeans', 'sulphites', 'tree_nuts']::text[]),
	CONSTRAINT "catalog_food_safety_allergen_classification_disjoint" CHECK (NOT ("catalog_food_safety_reviews"."contains_allergens" && "catalog_food_safety_reviews"."may_contain_allergens")),
	CONSTRAINT "catalog_food_safety_source_note_valid" CHECK (length(trim("catalog_food_safety_reviews"."source_note")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "catalog_food_safety_reviews" ADD CONSTRAINT "catalog_food_safety_reviews_food_id_catalog_foods_id_fk" FOREIGN KEY ("food_id") REFERENCES "public"."catalog_foods"("id") ON DELETE cascade ON UPDATE no action;