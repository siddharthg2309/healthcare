# Decision 0013: Groq for image and text inference

Date: 22 October 2026

## Selection and configuration

The owner requested a free API alternative for two people primarily estimating food from photographs or typed names, and reported adding a Groq key locally and in Vercel. Prefer Groq whenever `GROQ_API_KEY` is configured, using the pinned multimodal model `qwen/qwen3.8-27b`. This supersedes Decision 0007's Gemini-only selection.

The server resolves the provider once from environment configuration:

1. An explicit `AI_PROVIDER=groq` or `AI_PROVIDER=gemini` selects that provider.
2. Without an explicit selection, a present Groq key selects Groq.
3. Otherwise the existing Gemini configuration is selected.

An explicitly selected provider with no key reports AI unavailable. There is no automatic cross-provider fallback or model substitution. Existing `AI_MODEL` remains the Gemini-specific model setting, so a deployment's old Gemini value cannot be sent to Groq. Optional `GROQ_MODEL` accepts the supported model only; it defaults correctly without another Vercel variable. `GEMINI_API_KEY` and `AI_MODEL=gemini-3.1-flash-lite` remain usable by explicitly selecting Gemini and redeploying. Google sign-in and Calendar OAuth retain their separate credentials.

## Adapter and call sites

Replace the Gemini-specific transport module with `ai-provider.ts`. It sends the existing bounded chat message and strict JSON-schema contracts to the selected provider's documented HTTPS endpoint. Qwen uses `reasoning_effort=none` for efficient instruct mode; Gemini retains `minimal`. No SDK or dependency is added. The provider receives no tools, and the model cannot execute commands, fetch arbitrary URLs, write records, approve plans, or choose an account.

Food text/photos, cardio screenshots, and the two bounded LangGraph planners all use this adapter. Their configuration checks and saved model names use the resolved provider configuration. New run snapshots additionally identify the provider. Food draft signatures carry the actual selected model; existing signed drafts and historical nutrition snapshots keep their original model rather than being relabelled.

Food/cardio extraction retains its shared 40-second deadline and at most one transport retry for connection failures and HTTP 500/502/503/504. The same provider is retried. HTTP 429, authentication/configuration errors, and invalid JSON/schema responses are not automatically retried. Planners retain their existing per-call deadline, bounded repair, and explicit user approval. Returned usage is recorded; unreported cost remains unknown. A retry can make provider request counts exceed the account operation count.

## Compact free-tier requests

- Groq food responses have a 2,048-token output cap, retaining up to six food estimates and their uncertainty and macros.
- Groq meal planning uses up to 40 eligible candidates, at most two items per meal, brief notes, and a 3,500-token output cap. Gemini retains its existing limits. The full food catalog is still searchable without AI.
- Groq workout prompts omit redundant technique/rest prose from the candidate list. IDs, names, movement patterns, muscles, equipment, locations, and tracking modes remain in the prompt; full reviewed exercise definitions remain in server validation and UI.

These reductions do not guarantee provider quota availability. Large plans may exceed organization token limits or fail validation. The application's existing default limit remains 10 AI operations per account per rolling 24 hours, across all AI features. The provider account has separate shared request/token limits. The app does not configure billing or guarantee free capacity; the provider account's plan and terms control charges and processing.

## Validation, privacy, and persistence

Server authentication, owner isolation, input bounds, image byte validation, no-tool prompts, private reusable foods, deterministic macro arithmetic, immutable records, signed food confirmations, activity import ownership, and plan validation/approval remain required. Strict JSON is a structural control, not proof that a dish, portion, hidden ingredient, or calorie estimate is correct. The user reviews estimates before saving.

Images and bounded context are sent to the configured AI provider. The app does not store uploaded image bytes. Run metadata keeps safe provider/model/status and usage; logs exclude keys, images, prompts, account identifiers, and raw provider error bodies. Existing UI disclosures refer to the configured provider rather than incorrectly saying every request goes to Google. Provider processing remains governed by its own terms. No migration, new storage service, or new dependency is needed.

## Status

The owner reported configuring `GROQ_API_KEY` in both environments. Builds, typecheck, tests, browser checks, live inference, and runtime verification were not run, following the standing request to finish without checks. Required Git secret-scanning hooks still run at commit/push. This records an implemented integration, not verified live model access, latency, nutrition accuracy, or deployment success.

## Primary references

- [Groq OpenAI compatibility](https://console.groq.com/docs/openai)
- [Groq image inputs](https://console.groq.com/docs/vision)
- [Qwen 3.8 27B model and instruct mode](https://console.groq.com/docs/model/qwen/qwen3.8-27b)
- [Groq strict structured outputs](https://console.groq.com/docs/structured-outputs)
- [Groq account rate limits](https://console.groq.com/docs/rate-limits)
