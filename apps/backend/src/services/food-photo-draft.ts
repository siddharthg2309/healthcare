import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { foodPhotoEstimateSchema, foodLogRecordSchema, type ConfirmFoodPhotoRequest, type FoodPhotoEstimate } from "@healthcare/contracts";
import { env } from "../env.js";

const draftSchema = z.object({
  userId: z.string().min(1).max(200),
  runId: z.string().uuid(),
  model: z.string().min(1).max(100),
  expiresAt: z.number().int().positive(),
  estimate: foodPhotoEstimateSchema,
}).strict();

function signature(payload: string): Buffer {
  return createHmac("sha256", env.AUTH_SECRET).update("food-photo-draft-v1.").update(payload).digest();
}

export function signFoodPhotoDraft(userId: string, runId: string, estimate: FoodPhotoEstimate): string {
  const payload = Buffer.from(JSON.stringify(draftSchema.parse({ userId, runId, model: env.AI_MODEL, expiresAt: Date.now() + 2 * 60 * 60 * 1000, estimate }))).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function readFoodPhotoDraft(token: string, userId: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const supplied = Buffer.from(parts[1], "base64url");
    const expected = signature(parts[0]);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const parsed = draftSchema.safeParse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
    return parsed.success && parsed.data.userId === userId && parsed.data.expiresAt > Date.now() ? parsed.data : null;
  } catch {
    return null;
  }
}

type Draft = z.infer<typeof draftSchema>;

function recordId(userId: string, requestId: string, index: number): string {
  const bytes = createHash("sha256").update(`photo-log:${userId}:${requestId}:${index}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function buildPhotoFoodRecords(draft: Draft, request: ConfirmFoodPhotoRequest) {
  return request.items.map((item) => {
    const original = draft.estimate.items[item.index];
    if (!original) throw new Error("invalid_photo_item");
    const nutrition = item.nutritionPer100g ?? original.nutritionPer100g;
    const quantityGrams = Math.round((item.minimumGrams + item.maximumGrams) / 2 * 100) / 100;
    const round = (value: number) => Math.round(value * 100) / 100;
    const id = recordId(draft.userId, request.requestId, item.index);
    const data = foodLogRecordSchema.parse({
      foodId: id,
      foodSource: "photo_estimate",
      foodName: item.name,
      category: "photo_estimate",
      occurredAt: request.occurredAt,
      mealType: request.mealType,
      quantityGrams,
      nutritionPer100g: nutrition,
      nutritionTotal: {
        caloriesKcal: round(nutrition.caloriesKcal * quantityGrams / 100),
        proteinG: round(nutrition.proteinG * quantityGrams / 100),
        carbohydrateG: round(nutrition.carbohydrateG * quantityGrams / 100),
        fatG: round(nutrition.fatG * quantityGrams / 100),
      },
      photoEstimate: {
        runId: draft.runId, model: draft.model, requestId: request.requestId, itemIndex: item.index,
        minimumGrams: item.minimumGrams, maximumGrams: item.maximumGrams,
        certainty: item.certainty, confidence: original.confidence,
        userAdjusted: item.name !== original.name || item.minimumGrams !== original.minimumGrams
          || item.maximumGrams !== original.maximumGrams || JSON.stringify(nutrition) !== JSON.stringify(original.nutritionPer100g),
      },
    });
    return { id, data };
  });
}
