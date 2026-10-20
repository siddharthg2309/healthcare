ALTER TABLE "user_foods" ADD CONSTRAINT "user_foods_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "food_day_statuses" ADD CONSTRAINT "food_day_statuses_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_result_plan_id_plans_id_fk" FOREIGN KEY ("result_plan_id") REFERENCES "plans"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_redeemed_by_user_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_foods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "food_day_statuses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_runs" FORCE ROW LEVEL SECURITY;
