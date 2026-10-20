CREATE TABLE "reminder_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE "reminder_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "reminder_preferences_owner_policy" ON "reminder_preferences" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "reminder_preferences" FORCE ROW LEVEL SECURITY;
