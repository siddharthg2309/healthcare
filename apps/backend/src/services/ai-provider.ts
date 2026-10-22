import { env } from "../env.js";
import { setTimeout as delay } from "node:timers/promises";

// A Groq key takes precedence unless the operator explicitly selects Gemini.
// Provider-specific model settings prevent an old Gemini AI_MODEL from reaching Groq.
export const aiProvider = env.AI_PROVIDER ?? (env.GROQ_API_KEY ? "groq" : "gemini");
export const aiModel = aiProvider === "groq" ? env.GROQ_MODEL : env.AI_MODEL;
const apiKey = aiProvider === "groq" ? env.GROQ_API_KEY : env.GEMINI_API_KEY;
const endpoint = aiProvider === "groq"
  ? "https://api.groq.com/openai/v1/chat/completions"
  : "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
export const isAiConfigured = () => Boolean(apiKey);

interface CompletionRequest {
  messages: unknown[];
  temperature: number;
  max_tokens: number;
  response_format: unknown;
}

export class AiConnectionError extends Error {
  constructor() { super("ai_connection_failed"); this.name = "AiConnectionError"; }
}

/** One optional transient retry shares the caller's overall deadline. */
export async function chatCompletion(request: CompletionRequest, signal: AbortSignal, options: { retryTransient?: boolean } = {}): Promise<Response> {
  if (!apiKey) throw new Error("ai_not_configured");
  const init = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...request,
      model: aiModel,
      // Groq Qwen supports instruct mode; Gemini has its own effort vocabulary.
      reasoning_effort: aiProvider === "groq" ? "none" : "minimal",
    }),
    signal,
  };
  const attempts = options.retryTransient ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(endpoint, init);
    } catch (error) {
      if (signal.aborted) throw error;
      if (!(error instanceof TypeError)) throw error;
      if (attempt + 1 >= attempts) throw new AiConnectionError();
      // No keys, prompts, images, user identifiers, or provider bodies in logs.
      console.warn(JSON.stringify({ event: "ai_transient_retry", provider: aiProvider, reason: "connection", attempt: attempt + 1 }));
      await delay(700 + Math.floor(Math.random() * 400), undefined, { signal });
      continue;
    }
    if (![500, 502, 503, 504].includes(response.status) || attempt + 1 >= attempts) return response;
    console.warn(JSON.stringify({ event: "ai_transient_retry", provider: aiProvider, status: response.status, attempt: attempt + 1 }));
    await response.body?.cancel().catch(() => undefined);
    await delay(700 + Math.floor(Math.random() * 400), undefined, { signal });
  }
  throw new AiConnectionError();
}
