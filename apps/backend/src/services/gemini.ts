import { env } from "../env.js";

interface CompletionRequest {
  messages: unknown[];
  temperature: number;
  max_tokens: number;
  response_format: unknown;
}

/** Shared server-only transport; callers validate schemas and own retry limits. */
export function geminiChatCompletion(request: CompletionRequest, signal: AbortSignal): Promise<Response> {
  if (!env.GEMINI_API_KEY) throw new Error("gemini_not_configured");
  return fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
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
  });
}
