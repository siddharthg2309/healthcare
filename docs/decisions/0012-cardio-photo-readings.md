# Decision 0012: Reviewed cardio photo readings

Date: 21 October 2026

## Experience

Walk and Cardio have optional **Upload screenshot** and **Take photo** actions for a single completed Strava/app session or treadmill/machine display. The image reader proposes visible minutes, distance, calories, activity kind, calorie basis, confidence, and one clarification when useful. Owners review and correct the fields, select the activity/pace, choose the date/time, then explicitly save. Unreadable/absent values stay blank. An unrelated or multi-session image does not become a log.

Calories labelled only “Calories” have an unknown basis. The app does not infer active-versus-total from a brand name. A “Not sure / not labelled” option remains available. Duration and activity type remain editable; rounding extracted time to whole minutes matches existing records. Distance is recorded in kilometres and does not independently create another calorie estimate.

Strength continues to record exercise names, sets, repetitions or timed holds, loads, session minutes, and training style. Reps and load support performance history. They do not imply a reliable direct calorie calculation. Body weight, session duration, and the selected Compendium intensity produce its estimate.

## One energy value per session

Each activity retains its deterministic MET fallback and weight snapshot. A reviewed `cardioReport` stores the owned photo run ID, reported kcal, calorie basis, and optional distance. These are user-confirmed assertions, not verified measurements. The original bounded numerical extraction stays in the private AI run for provenance; edited readings stay in the activity version.

The shared domain resolver selects exactly one net-active value:

- Explicit **active** reading: use that reviewed number once.
- Explicit **total** reading: subtract `3.5 × saved weight kg / 200 × minutes` for the session's resting energy, rounded to whole kcal and clamped at zero. This uses the same 1-MET convention as the app's fallback. Missing weight prevents this conversion.
- Unknown basis or missing reading: retain the existing MET estimate if available. Otherwise energy remains unknown.

The screenshot reading and fallback are never added together. Daily summaries, Home, weekly review, and the goal energy ledger all use the same resolver. Recorded steps are shown separately and do not add a second energy estimate. Session history identifies estimated, reported, or adjusted-total calories. Reported and calculated burn both remain estimates; none increases the accepted food allowance or replaces measured-weight trends. Duplicate or overlapping sessions entered independently can still overlap energy.

General cycling adds Compendium code `01014`, 7 MET. Existing jogging is labelled **Run / treadmill jog**. Users still need to choose an appropriate pace/type: a photograph cannot establish a personalised energy model.

## Backend, ownership, and bounded AI

`POST /v1/activities/recognize-photo` requires the authenticated session, a supported JPEG/PNG/WebP MIME type, canonical bounded base64, and matching image bytes. Browser preparation shares food-photo compression: maximum 20 MB input, resized JPEG, maximum 2.5 MB uploaded bytes. The endpoint caps JSON body size. Each attempt reserves the shared rolling 24-hour account quota before a bounded extraction operation; no autonomous tools run. A later resilience update allows one transient transport retry within the same overall deadline. The existing Gemini key/model are reused, with a 40-second timeout and validated structured output.

The vision system prompt treats image text as untrusted data. It instructs the model to extract visible readings only, leave ambiguous values unknown, and never follow embedded commands or infer calories from appearance or heart rate. Schema validation and ownership checks run in application code. These reduce injection risk; model obedience is not a security boundary for calculations or writes.

Activity create, update, and sync verify that the referenced completed run belongs to the authenticated owner and represents an activity image. A per-run advisory lock plus an owner-filtered activity lookup prevents the same run from being attached to two active records. The create ID provides identical-request retry protection; edits keep optimistic record versions. This is not duplicate-image detection: re-uploading a file creates a new run. Older clients cannot silently drop an existing report on edit; the current editor explicitly signals removal. The generic sync path requires the activity editor for removal.

The existing `ai_runs.kind=food_vision` storage bucket is retained for migration compatibility; `inputType=cardio_photo`, prompt and schema versions distinguish this operation from food. Food confirmation already checks its own signed input type. No image bytes, names, locations, routes, or provider response bodies are intentionally retained; the AI run keeps bounded numerical readings, activity classification, confidence, usage, and sanitized failure codes. The optional question is shown in the review but not persisted. Images are sent to Google AI; provider handling follows the configured service's terms.

## Goals and deployment

This extends the existing versioned goal budget and measured-weight progress implementation. It does not replace that numerical method with LLM predictions or claim clinical validation. AI assists extraction and optional planning; application code performs the calorie accounting and graph calculations.

No new environment variables, storage bucket, dependency, or database migration is required. The preceding weekly-review migration 0020 remains required and was already applied to the configured Neon database.

Builds, typecheck, tests, browser checks, live inference, and numerical/runtime verification were not run, following the owner's instruction to finish without checks. Required Git secret-scanning hooks still run at commit and push. Deployment readiness and image-reading quality need runtime confirmation after deployment.

## Sources

- [2024 Adult Compendium: bicycling](https://pacompendium.com/bicycling/) supplies cycling MET categories; these are population estimates.
- [2024 Adult Compendium](https://pacompendium.com/) explains the resting MET convention.
- [Strava: How does Strava calculate calories?](https://support.strava.com/en-us/articles/15402159-how-does-strava-calculate-calories) explains that calories are estimates and can come from upload partners with different calculations. It does not justify treating every generic Strava calorie label as active calories.
