import { env } from "../env.js";
import { setTimeout as delay } from "node:timers/promises";

interface CompletionRequest {
  messages: unknown[];
  temperature: number;
  max_tokens: number;
  response_format: unknown;
}

export class GeminiConnectionError extends Error {
  constructor() { super("gemini_connection_failed"); this.name = "GeminiConnectionError"; }
}

/** One optional transient retry shares the caller's overall deadline. */
export async function geminiChatCompletion(request: CompletionRequest, signal: AbortSignal, options: { retryTransient?: boolean } = {}): Promise<Response> {
  if (!env.GEMINI_API_KEY) throw new Error("gemini_not_configured");
  const init = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GEMINI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...request,
      model: env.AI_MODEL,
      reasoning_effort: "minimal",
    }),
    signal,
  };
  const attempts = options.retryTransient ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", init);
    } catch (error) {
      if (signal.aborted) throw error;
      if (!(error instanceof TypeError)) throw error;
      if (attempt + 1 >= attempts) throw new GeminiConnectionError();
      // No keys, prompts, images, user identifiers, or provider bodies in logs.
      console.warn(JSON.stringify({ event: "gemini_transient_retry", reason: "connection", attempt: attempt + 1 }));
      await delay(700 + Math.floor(Math.random() * 400), undefined, { signal });
      continue;
    }
    if (![500, 502, 503, 504].includes(response.status) || attempt + 1 >= attempts) return response;
    console.warn(JSON.stringify({ event: "gemini_transient_retry", status: response.status, attempt: attempt + 1 }));
    await response.body?.cancel().catch(() => undefined);
    await delay(700 + Math.floor(Math.random() * 400), undefined, { signal });
  }
  throw new GeminiConnectionError();
}
