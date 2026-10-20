ALTER TABLE "private_uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_sync_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_foods" ADD CONSTRAINT "catalog_foods_nutrition_nonnegative" CHECK (
    "catalog_foods"."calories_kcal_per_100g" >= 0 AND "catalog_foods"."protein_g_per_100g" >= 0
    AND "catalog_foods"."carbohydrate_g_per_100g" >= 0 AND "catalog_foods"."fat_g_per_100g" >= 0
  );--> statement-breakpoint
ALTER TABLE "job_queue" ADD CONSTRAINT "job_queue_status_valid" CHECK ("job_queue"."status" IN ('pending', 'leased', 'completed', 'failed'));--> statement-breakpoint
ALTER TABLE "job_queue" ADD CONSTRAINT "job_queue_attempts_valid" CHECK ("job_queue"."attempts" >= 0 AND "job_queue"."max_attempts" > 0 AND "job_queue"."attempts" <= "job_queue"."max_attempts");--> statement-breakpoint
ALTER TABLE "private_uploads" ADD CONSTRAINT "private_uploads_size_positive" CHECK ("private_uploads"."byte_size" > 0 AND "private_uploads"."byte_size" <= 10485760);--> statement-breakpoint
CREATE POLICY "private_uploads_owner_policy" ON "private_uploads" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "sync_changes_owner_policy" ON "sync_changes" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "sync_requests_owner_policy" ON "sync_requests" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "user_profiles_owner_policy" ON "user_profiles" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "user_records_owner_policy" ON "user_records" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
CREATE POLICY "user_sync_counters_owner_policy" ON "user_sync_counters" AS PERMISSIVE FOR ALL TO public USING (user_id = current_setting('app.user_id', true)) WITH CHECK (user_id = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "private_uploads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_sync_counters" FORCE ROW LEVEL SECURITY;
