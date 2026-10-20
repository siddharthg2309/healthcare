import { and, eq, gte, sql } from "drizzle-orm";
import { aiRuns } from "@healthcare/database/schema";
import { db } from "@healthcare/database";
import { env } from "../env.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const AI_OPERATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Serialize quota checks with run creation so concurrent requests cannot overshoot the limit. */
export async function lockAiUsageWindow(tx: Transaction, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"goal-health-ai-quota:" + userId}, 0))`);
}

/** Call after acquiring the per-user advisory lock and before inserting the ai_runs row. */
export async function hasAiOperationCapacity(
  tx: Transaction,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const windowStart = new Date(now.getTime() - AI_OPERATION_WINDOW_MS);
  const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(aiRuns).where(and(
    eq(aiRuns.userId, userId),
    gte(aiRuns.createdAt, windowStart),
  ));
  return (usage?.count ?? 0) < env.AI_USER_DAILY_OPERATION_LIMIT;
}
