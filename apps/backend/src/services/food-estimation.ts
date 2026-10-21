import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@healthcare/database";
import { aiRuns } from "@healthcare/database/schema";
import type { FoodPhotoRecognitionRequest, FoodTextEstimateRequest } from "@healthcare/contracts";
import { env } from "../env.js";
import { FoodVisionError, estimateFoodText, recognizeFoodPhoto } from "./food-vision.js";
import { hasAiOperationCapacity, lockAiUsageWindow } from "./ai-usage.js";
import { signFoodPhotoDraft } from "./food-photo-draft.js";

export const SAVED_AI_FOOD_PREFIX = "AI estimate (unverified).";

/** Both input modes share the existing food-inference quota and review contract. */
export async function createFoodEstimate(userId: string, input: FoodPhotoRecognitionRequest | FoodTextEstimateRequest) {
  if (!env.GEMINI_API_KEY) throw new FoodVisionError("ai_not_configured", 503);
  const inputType = "foodName" in input ? "text" as const : "photo" as const;
  const runId = randomUUID();
  const reserved = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    await lockAiUsageWindow(tx, userId);
    if (!(await hasAiOperationCapacity(tx, userId))) return false;
    await tx.insert(aiRuns).values({
      id: runId, userId,
      // Retain the existing DB kind; inputType distinguishes text from photos.
      kind: "food_vision", status: "running", idempotencyKey: randomUUID(),
      inputHash: createHash("sha256").update(runId).digest("hex"),
      inputSnapshot: {
        inputType, contextCharacters: input.context?.length ?? 0,
        ...("foodName" in input ? { foodNameCharacters: input.foodName.length } : { mimeType: input.mimeType, base64Characters: input.base64.length }),
      },
      model: env.AI_MODEL,
      promptVersion: inputType === "text" ? "food-text-estimate-v1" : "food-photo-estimate-v3",
      schemaVersion: "food-estimate-v3",
    });
    return true;
  });
  if (!reserved) throw new FoodVisionError("ai_daily_limit_reached", 429);
  try {
    const result = "foodName" in input ? await estimateFoodText(input) : await recognizeFoodPhoto(input);
    const draftToken = signFoodPhotoDraft(userId, runId, result.response, inputType, "foodName" in input ? input.foodName : undefined);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      await tx.update(aiRuns).set({ status: "completed", inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsdMicros: result.costUsdMicros, updatedAt: new Date() })
        .where(and(eq(aiRuns.userId, userId), eq(aiRuns.id, runId)));
    });
    return { ...result.response, draftToken, inputType, candidates: result.response.items.map((item) => ({ name: item.name, alternatives: [] })) };
  } catch (error) {
    const failure = error instanceof FoodVisionError ? error : new FoodVisionError("ai_provider_unavailable", 503);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      await tx.update(aiRuns).set({
        status: "failed", errorCode: failure.code,
        inputTokens: failure.usage?.inputTokens ?? null, outputTokens: failure.usage?.outputTokens ?? null,
        costUsdMicros: failure.usage?.costUsdMicros ?? null, updatedAt: new Date(),
      }).where(and(eq(aiRuns.userId, userId), eq(aiRuns.id, runId), eq(aiRuns.status, "running")));
    });
    throw failure;
  }
}
