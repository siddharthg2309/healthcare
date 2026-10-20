ALTER TABLE "job_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "job_queue_worker_policy" ON "job_queue" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.worker_access', true) = 'true') WITH CHECK (current_setting('app.worker_access', true) = 'true');--> statement-breakpoint
ALTER TABLE "job_queue" FORCE ROW LEVEL SECURITY;
