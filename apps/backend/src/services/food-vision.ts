import {
  foodPhotoRecognitionResponseSchema,
  type FoodPhotoRecognitionRequest,
  type FoodPhotoRecognitionResponse,
} from "@healthcare/contracts";
import { env } from "../env.js";
import { openRouterCostToMicros } from "./ai-usage.js";

export type FoodVisionStatus = 400 | 429 | 502 | 503 | 504;

export interface FoodVisionUsage {
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number | null;
}

export class FoodVisionError extends Error {
  constructor(
    readonly code: string,
    readonly status: FoodVisionStatus,
    readonly usage: FoodVisionUsage | null = null,
  ) {
    super(code);
    this.name = "FoodVisionError";
  }
}

function imageMatchesMimeType(bytes: Buffer, mimeType: FoodPhotoRecognitionRequest["mimeType"]): boolean {
  if (mimeType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function responseText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function parseRecognition(text: string): FoodPhotoRecognitionResponse {
  const fence = String.fromCharCode(96, 96, 96);
  const jsonText = text.trim()
    .replace(new RegExp("^" + fence + "(?:json)?\\s*", "i"), "")
    .replace(new RegExp("\\s*" + fence + "$"), "");
  let decoded: unknown;
  try {
    decoded = JSON.parse(jsonText);
  } catch {
    throw new FoodVisionError("ai_invalid_response", 502);
  }
  const parsed = foodPhotoRecognitionResponseSchema.safeParse(decoded);
  if (!parsed.success) throw new FoodVisionError("ai_invalid_response", 502);
  return parsed.data;
}

export interface FoodVisionResult extends FoodVisionUsage {
  response: FoodPhotoRecognitionResponse;
}

function safeTokenCount(value: unknown): number {
  const count = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

export async function recognizeFoodPhoto(
  image: FoodPhotoRecognitionRequest,
): Promise<FoodVisionResult> {
  const bytes = Buffer.from(image.base64, "base64");
  if (bytes.toString("base64") !== image.base64 || bytes.length < 128 || bytes.length > 2_500_000
    || !imageMatchesMimeType(bytes, image.mimeType)) {
    throw new FoodVisionError("invalid_food_photo", 400);
  }
  if (!env.OPENROUTER_API_KEY) throw new FoodVisionError("ai_not_configured", 503);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": env.AUTH_BASE_URL,
        "X-Title": "Goal Health",
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        temperature: 0.1,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content: "Identify visible foods for a food-tracking app. Return only a JSON object with this shape: {\"candidates\":[{\"name\":\"short searchable food name\",\"alternatives\":[]}],\"note\":null}. List at most 6 distinct visible food items. For mixed dishes, prefer the dish name instead of guessing hidden ingredients. Do not estimate portion size, weight, calories, macros, or ingredients that are not visible. Mention uncertainty briefly in note. If no food is identifiable, return an empty candidates array and a short note.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Suggest searchable names for the food visible in this image." },
              {
                type: "image_url",
                image_url: { url: "data:" + image.mimeType + ";base64," + image.base64 },
              },
            ],
          },
        ],
        provider: { require_parameters: true },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "food_photo_recognition",
            strict: true,
            schema: {
              type: "object",
              properties: {
                candidates: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      alternatives: { type: "array", items: { type: "string" } },
                    },
                    required: ["name", "alternatives"],
                    additionalProperties: false,
                  },
                },
                note: { anyOf: [{ type: "string" }, { type: "null" }] },
              },
              required: ["candidates", "note"],
              additionalProperties: false,
            },
          },
        },
      }),
      signal: controller.signal,
    });

    if (response.status === 429) throw new FoodVisionError("ai_rate_limited", 429);
    if (!response.ok) throw new FoodVisionError("ai_provider_unavailable", 503);
    const body = await response.json().catch(() => null) as {
      choices?: unknown;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown };
    } | null;
    const usage: FoodVisionUsage = {
      inputTokens: safeTokenCount(body?.usage?.prompt_tokens),
      outputTokens: safeTokenCount(body?.usage?.completion_tokens),
      costUsdMicros: openRouterCostToMicros(body?.usage?.cost),
    };
    const text = responseText(body);
    if (!text) throw new FoodVisionError("ai_invalid_response", 502, usage);
    try {
      return { response: parseRecognition(text), ...usage };
    } catch (error) {
      if (error instanceof FoodVisionError) throw new FoodVisionError(error.code, error.status, usage);
      throw error;
    }
  } catch (error) {
    if (error instanceof FoodVisionError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new FoodVisionError("ai_timeout", 504);
    }
    throw new FoodVisionError("ai_provider_unavailable", 503);
  } finally {
    clearTimeout(timeout);
  }
}
