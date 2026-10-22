# Decision 0007: Use Google AI Studio for AI features

Date: 21 October 2026

Provider selection is superseded by [Decision 0013](0013-groq-provider.md): Groq is preferred when its key is configured; Gemini remains an explicit operator alternative.

## Decision

Replace MiniMax through OpenRouter with direct Google AI Studio calls for food-photo naming and the meal/workout LangGraph workflows. Default to `gemini-3.1-flash-lite`, configured through optional `AI_MODEL`, and keep `GEMINI_API_KEY` server-only. This supersedes the model-provider selection in Decision 0001.

Use Google's [documented OpenAI-compatible REST endpoint](https://ai.google.dev/gemini-api/docs/openai) to preserve the current message and JSON Schema contracts. The [stable selected model](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) supports images and structured output. The shared adapter applies minimal reasoning effort; callers retain timeouts and output limits. No new dependency is needed.

## Configuration and migration

- Add `GEMINI_API_KEY` to the ignored local `.env` and Vercel Production variables, then deploy the updated code.
- Use `AI_MODEL=gemini-3.1-flash-lite` or leave it absent/blank. The previous `minimax/minimax-m3` default maps to Gemini automatically for existing deployments.
- `OPENROUTER_API_KEY` is no longer used. Google sign-in and Calendar OAuth credentials remain separate.
- No database migration is required. Historical AI runs keep their original model and cost records.

## Constraints and validation

Existing authentication, per-account rolling quotas, photo validation, untrusted-input guards, catalog-only candidate validation, deterministic nutrition, one planning repair, and explicit plan approval remain in place. Provider calls send no tools. There is no automatic fallback provider or quota retry. Token counts are recorded; unreported dollar cost stays null.

Free API access is subject to project/model limits and Google's tier-specific content-use terms; see [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [quotas](https://ai.google.dev/gemini-api/docs/rate-limits). Google Cloud budget alerts are not a hard spend cap.

The owner requested finishing without checks. No build, typecheck, browser verification, or live inference was run for this migration. Deployment and provider operation still need confirmation.
