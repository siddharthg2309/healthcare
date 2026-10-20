CREATE TYPE "public"."record_entity" AS ENUM('food_log', 'activity_log', 'body_measurement', 'goal');--> statement-breakpoint
CREATE TABLE "catalog_foods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"calories_kcal_per_100g" numeric(9, 2) NOT NULL,
	"protein_g_per_100g" numeric(8, 2) NOT NULL,
	"carbohydrate_g_per_100g" numeric(8, 2) NOT NULL,
	"fat_g_per_100g" numeric(8, 2) NOT NULL,
	"source" text NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reservation_expires_at" timestamp with time zone,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "job_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 4 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"idempotency_key" text,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "private_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_uploads_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "sync_changes" (
	"user_id" text NOT NULL,
	"cursor" integer NOT NULL,
	"entity" "record_entity" NOT NULL,
	"record_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb,
	"deleted" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_changes_user_id_cursor_pk" PRIMARY KEY("user_id","cursor")
);
--> statement-breakpoint
CREATE TABLE "sync_requests" (
	"user_id" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_requests_user_id_idempotency_key_pk" PRIMARY KEY("user_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_records" (
	"user_id" text NOT NULL,
	"entity" "record_entity" NOT NULL,
	"record_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"data" jsonb,
	"deleted" boolean DEFAULT false NOT NULL,
	"client_updated_at" timestamp with time zone,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_records_user_id_entity_record_id_pk" PRIMARY KEY("user_id","entity","record_id")
);
--> statement-breakpoint
CREATE TABLE "user_sync_counters" (
	"user_id" text PRIMARY KEY NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "catalog_foods_name_idx" ON "catalog_foods" USING btree ("name");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "job_queue_claim_idx" ON "job_queue" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_queue_idempotency_idx" ON "job_queue" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "private_uploads_owner_idx" ON "private_uploads" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "sync_changes_created_idx" ON "sync_changes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_requests_created_idx" ON "sync_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "user_records_updated_idx" ON "user_records" USING btree ("user_id","server_updated_at");
--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "user_records" ADD CONSTRAINT "user_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "user_sync_counters" ADD CONSTRAINT "user_sync_counters_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "sync_requests" ADD CONSTRAINT "sync_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "sync_changes" ADD CONSTRAINT "sync_changes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "private_uploads" ADD CONSTRAINT "private_uploads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "job_queue" ADD CONSTRAINT "job_queue_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
