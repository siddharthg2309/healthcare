CREATE TABLE "calendar_event_links" (
	"user_id" text NOT NULL,
	"occurrence_key" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_version" integer NOT NULL,
	"occurrence_date" text NOT NULL,
	"google_event_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_event_links_user_id_occurrence_key_pk" PRIMARY KEY("user_id","occurrence_key"),
	CONSTRAINT "calendar_event_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE,
	CONSTRAINT "calendar_event_links_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE,
	CONSTRAINT "calendar_event_links_version_positive" CHECK ("calendar_event_links"."plan_version" > 0),
	CONSTRAINT "calendar_event_links_date_format" CHECK ("calendar_event_links"."occurrence_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "calendar_event_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "google_calendar_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"calendar_id" text NOT NULL,
	"calendar_name" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_calendar_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE "google_calendar_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "google_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_oauth_states_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE "google_oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "calendar_event_links_owner_date_idx" ON "calendar_event_links" USING btree ("user_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "google_oauth_states_owner_expiry_idx" ON "google_oauth_states" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE POLICY "calendar_event_links_owner_policy" ON "calendar_event_links" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "google_calendar_connections_owner_policy" ON "google_calendar_connections" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "google_oauth_states_owner_policy" ON "google_oauth_states" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "calendar_event_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "google_calendar_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "google_oauth_states" FORCE ROW LEVEL SECURITY;
