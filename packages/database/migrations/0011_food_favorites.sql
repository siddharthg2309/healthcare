CREATE TABLE "food_favorites" (
	"user_id" text NOT NULL,
	"food_source" text NOT NULL,
	"food_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_favorites_user_id_food_source_food_id_pk" PRIMARY KEY("user_id","food_source","food_id"),
	CONSTRAINT "food_favorites_source_valid" CHECK ("food_favorites"."food_source" IN ('shared_catalog', 'personal'))
);
--> statement-breakpoint
ALTER TABLE "food_favorites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "food_favorites_owner_created_idx" ON "food_favorites" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE POLICY "food_favorites_owner_policy" ON "food_favorites" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "food_favorites" ADD CONSTRAINT "food_favorites_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "food_favorites" FORCE ROW LEVEL SECURITY;
