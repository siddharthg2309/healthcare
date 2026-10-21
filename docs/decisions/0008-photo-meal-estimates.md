# Decision 0008: Estimate and review a photographed meal

Date: 21 October 2026

## Decision

Replace name-only photo recognition with a bounded food/portion/nutrition estimate. The user can log a reviewed photo meal directly without searching the catalog. This changes the original photo scope; meal/workout LangGraph workflows remain unchanged.

The model returns up to six items with names, cooked gram ranges, uncalibrated confidence, and calories/protein/carbs/fat per 100 g. It may ask one optional useful question. Context, including “not sure,” counts, labels, or recipes, can refine the estimate. A price alone does not establish mass. Photos cannot establish exact calories or allergy safety.

## Review and persistence

- Phone cards support Sure/Not sure quantities, ranges, item removal, and optional food/nutrition corrections. No manual macro entry is required.
- One explicit confirmation saves selected items together; a range uses its midpoint and retains the endpoints/certainty. Nutrition is calculated from validated densities and grams by app code.
- Store photo entries as `photo_estimate` with model/run provenance and user-correction metadata in existing owner-scoped JSON logs. Do not publish them as reviewed catalog foods.
- Use existing AUTH_SECRET to HMAC-sign a two-hour account-bound draft; validate signature, schema, ownership, expiry, completed run, and bounded edits before writes.
- Stable client request IDs, deterministic entry IDs, a transaction/advisory lock, and existing-record comparison protect confirmations from duplicate retries. Copies retain estimate provenance; later gram edits update the range.
- Raw images and clarification text remain outside app storage. Compressed images stay in browser memory until submitted, canceled, or the component is closed.

## Call limits and implementation limits

One model call per initial request, at most two user-initiated refinement attempts in the UI, no autonomous retries or tools. The server's rolling account quota applies to all inferences. A new photo/API request is still subject to that quota. Contexts are limited to 4,000 characters (the UI accepts 600 initial characters and 400 per answer, with bounded correction context). Image bytes and contexts are untrusted input and cannot override system rules or account ownership. Validators provide structural/plausibility bounds, not factual verification of nutrition. Output is capped at 4,096 tokens and calls time out after 30 seconds.

No new credentials or database migration are required. Build, typecheck, browser checks, and live inference were skipped at the owner's request; live behavior still needs verification.
