# Goal Health

A private, Android-first health and fitness app for food logging, activity tracking, and measured progress toward personal goals. The app UI and API are a Next.js PWA deployed to Vercel. A small Expo Android app can load that same hosted app in a WebView and be shared privately as an APK; the PWA URL also remains usable in Chrome. **No Play Store listing is required.**

The app and API are served by one Next.js project. Vercel hosts the web UI and server-side API routes; Neon provides the cloud Postgres database. Your laptop is needed for development and the one-time database migration, not for friends to use the deployed app.

The app is under implementation. The current build includes account setup, goal onboarding, the target-versus-weigh-in graph, personal food search and creation, a recipe builder with server-calculated macros, cooking instructions, and immutable version history, editable food logs, manual activity logging, daily nutrition summaries, food-day completion status, tools to seed generic USDA survey foods with source-provided serving weights and curate additional entries, and photo-based meal estimates with editable portions, calories, and macros. The person confirms the estimate and adds it directly to the log; no catalog search is required for photo meals. Meal and workout plans use bounded LangGraph workflows with editable drafts, deterministic checks, explicit review, approval/rejection, and history; meal-plan drafts support catalog food swaps with server-recalculated nutrition. Reviewed dietary/allergen metadata and server-side filtering are implemented, but the catalog still needs careful curation. Approved workout sessions link to the activity log only after the person records the work completed. Reminder preferences are saved per account, and optional browser notifications are checked while the PWA is open. Optional Google Calendar OAuth and one-way approved-workout sync are implemented and require server credentials. Broader Indian-food coverage, live deployment, and device integrations remain planned. See the [implementation plan](docs/IMPLEMENTATION_PLAN.md) for the phased scope and [environment setup](docs/ENVIRONMENT.md) for deployment steps.

## Stack

- Next.js App Router, React, and TypeScript, deployed as a PWA on Vercel
- Optional Expo Android WebView shell, built as an internal APK with EAS and configured with the public Vercel app URL
- Minimal black, white, gray, and lime-green visual system with Manrope
- Same-origin Next.js Route Handlers dispatching to the modular Hono API
- Neon Postgres with Drizzle migrations; Better Auth for Google sign-up and invite-gated email/password accounts
- Server-only Groq integration using `qwen/qwen3.8-27b` for image/text nutrition estimates, cardio screenshots, and meal/workout plans; `GROQ_API_KEY` selects Groq automatically. Optional Gemini configuration remains available through an explicit provider setting.
- Two bounded LangGraph workflows for meal and workout plans, with database-backed state and explicit user review

## Phone interface

The PWA uses a phone-width layout on every screen, with bottom navigation, safe-area spacing, readable input text, and thumb-sized controls. Food selection opens a bottom sheet: choose a saved serving size, adjust its count with − / + / +2, and add the total to a meal. Custom gram amounts and timestamps stay under **Custom amount & time**. Food and activity each separate their daily log from weekly plans.

Activity opens on a manual log. Enter exercises, sets/reps/loads, and session minutes for strength, or a cardio type and minutes. The app estimates active calories from saved body weight, activity, and duration, or uses the reviewed cardio readings described below. The large starter-session card is removed; **Use my routine** opens the separate routine tab. Meal planning and **Create template draft / Suggest with AI** in My routine remain available. Notes are collapsed and workout names are optional.

Calorie estimates use a versioned MET calculation from the [2024 Compendium](https://pacompendium.com/adult-compendium/), subtract resting energy, and stay separate from the accepted food allowance. Each new activity stores the weight and method used. Step-only entries and unspecified Other activities have no calorie estimate. Previously saved timed activities also get a calculated estimate when loaded; their saved records remain unchanged until edited. Home and Activity history show the daily estimated calories burned, with steps shown separately. Missing weight or minutes is flagged instead of silently displaying zero. These activity changes use JSON records and need no database migration. Builds and runtime checks were not run for this change, following the owner's request.

Serving counts use the existing JSON food-log records and do not require a database migration. The API validates the chosen portion against its owner and food, checks the total grams against the count, and calculates nutrition. Existing gram-only logs remain supported.

## Food macro totals

Home and Food show consumed protein, carbs, and fat from the same daily food-log totals, displayed to one decimal place. Home shows macro goals separately under **Goal**; these are targets, not consumed totals. Calorie totals use the same whole-kcal display rounding on both screens. Every food-log entry shows protein, carbs, and fat for its logged portion from the saved nutrition snapshot, including AI-estimated and recipe entries. Editing the logged quantity updates that snapshot through the existing API and refreshes the daily totals.

This UI correction needs no environment changes, database migration, or model calls. Build, typecheck, browser checks, and runtime verification remain skipped at the owner's request.

## Cardio screenshots and workout calories

Under **Activity → Walk / Cardio**, optionally upload a Strava screenshot or photograph a treadmill/machine display. Check the extracted minutes, activity type, distance, and reported calories; edit anything unclear and tap **Save reviewed activity**. Photos are read by the configured AI provider and are not stored by this app. Manual logging remains available.

Choose **Active calories**, **Total calories, including rest**, or **Not sure / not labelled**. Active readings count once. Total readings have session resting calories deducted using the saved weight; unknown readings keep the app's duration/weight estimate. An imported reading and the MET estimate are never summed. The selected energy flows through Home, Activity history, weekly reviews, and goal energy balances. History identifies reported versus estimated energy. Reusing the same import in two active records is rejected; independently uploaded or overlapping sessions still need care when logging.

Strength logs record exercise names, sets, reps, weight, and actual session minutes. Estimated burn uses body weight, duration, and training style; repetitions and lifted weight alone cannot establish calorie expenditure. Device readings also remain estimates, as [Strava explains](https://support.strava.com/en-us/articles/15402159-how-does-strava-calculate-calories).

No additional environment values or migrations are needed for cardio imports. The selected provider settings are reused (`GROQ_API_KEY`, or optional Gemini settings). The shared daily AI quota applies. Checks and live inference remain skipped at the owner's request. See [Decision 0012](docs/decisions/0012-cardio-photo-readings.md) for accounting, privacy, provenance, and limitations.

## Goals and Progress

On signup or under **Progress → Edit plan**, choose **My target date**, **My daily intake**, or **Weight tracking only**. Date mode suggests a daily intake; intake mode calculates an approximate timeline. Review the calorie budget, adjust it if needed, and explicitly accept the plan. Select Female/Male under **Calorie estimate** to enable a supported estimate; equation names stay out of the form. Everyday movement excludes workouts. Optional planned exercise is entered as an average across all seven days.

The budget shows estimated maintenance, chosen intake, initial daily/weekly/30-day deficit or surplus, first-week/month weight scenarios, and plan length. Numeric values come from versioned application code, with no AI call. The scenario uses a published reduced population approximation and is explicitly **not the full NIH model or a guaranteed weight prediction**. Infeasible plans show alternatives and a weight-tracking option.

Home adds an estimated energy balance. Complete food logs before a daily deficit is shown; missing meals and incomplete activity estimates remain unknown. Logged net workout calories are added once to the baseline, while the food allowance stays fixed. Existing accepted goals keep their original values: accept an updated plan to add a detailed energy budget.

Progress separates the accepted plan, measured weights/trend, and a recent-pace forecast. Tap the graph or use its date input to inspect food, activity, weight, balance, and logging completeness. Compare earlier accepted plan versions, see weight milestones, and open a calendar-week consistency review. Forecasts require at least six measured days across fourteen days, with recent evidence and a limited horizon. Their shaded rate-variation band is not a statistical confidence interval. Plan changes require preview and explicit acceptance; updated profiles/weights invalidate a stale preview. Changing a plan does not invent a new weigh-in.

The goal-budget upgrade uses existing JSON records and introduced no environment values or migrations. The weekly check-ins below add application migration 0020. Builds, typecheck, tests, browser checks, and numerical/live verification were not run for these interface changes, following the owner's request. Calculation methods, limits, history semantics, and remaining validation work are documented in [Decision 0010](docs/decisions/0010-goal-budgets-and-progress.md).

## Daily check-ins and weekly consistency

Home shows today's food, weight, and movement/rest check-ins with separate food-log and weigh-in streaks. **Open my weekly review** or **Progress → Weekly review** opens a Monday–Sunday review with per-day consumed/target calories, macros, recorded weights, activity/steps, estimated energy balance, and logging completeness. Move between weeks or select an older week. Future dates and dates before tracking began are not counted as missed days.

Use **Update this day** to mark a day as **Cheat day**, mark planned rest, save a short private note, complete an existing food log, or enter an actual missing weigh-in. **Open food log / Add food** opens the correct historical date. Food also has a date picker and **Today** shortcut. Cheat-day labels are chosen by the owner; numerical near/above/below-plan comparisons remain separate. Cheat days count toward logging consistency and do not reset streaks or change calorie allowances. Notes do not go to an LLM.

Weekly calorie/protein averages exclude incomplete food days. Missing weights stay blank; weekly recorded change is not a measurement of fat loss. Supportive coverage summaries point to the next missing check-in. These are in-app summaries, not scheduled background notifications or human supervision.

**Database:** `0020_daily_checkins.sql` adds check-in JSON and a version column to the existing owner-protected day-status table. It was applied successfully to the configured Neon database during implementation. For a different database, run `npm run db:app:migrate` before deploying this version. No new environment variables are needed. Existing account export and deletion cover these private day rows. See [Decision 0011](docs/decisions/0011-weekly-accountability.md). Runtime/UI checks remain skipped at the owner's request; the successful migration does not establish that the new screens have been verified.

## When a food is missing

Search the database first. If **All foods** returns no match, tap **Estimate “curd rice” with AI**, then add optional amount/recipe details such as “one bowl” or “300–400 g, not sure.” Tap **Estimate meal** to generate a draft. Typing, database searches, and opening the form do not call AI.

Text and photo estimates use the same editable review cards, Sure/Not sure portions, optional follow-up questions, and direct log confirmation. Confirming the meal automatically saves the selected foods privately to **My foods** along with the log; there is no extra checkbox. They appear in All foods and Recent for ordinary logging without another AI call. Cached nutrition is marked as an estimate in search, serving details, and future log entries. It is not published into the shared reviewed catalog. New recipe variants can be saved separately.

## Photo meal logging

Take or upload a photo to receive estimated foods, cooked portion ranges, calories, protein, carbs, and fat. Optional context can describe counts, recipes, labels, or an approximate amount. A short follow-up question can refine the estimate; answering is optional, and “not sure” is accepted. You can make up to two follow-up attempts, or edit the review cards yourself without another AI call.

Choose **Sure** for one gram amount or **Not sure** for a range such as 300–400 g. Calories and macros recalculate immediately. **Edit nutrition · per 100 g** allows optional corrections; leaving a field blank keeps its estimate. Tap **Add to food log** to save all selected items together. For a range, the midpoint is logged and the range/certainty remains attached to the entry.

Photo entries are labeled estimates and do not become reviewed catalog foods. The API validates text or photo estimates and signs an account-bound draft valid for two hours. Confirmation verifies that draft, applies bounded user corrections, calculates totals, and saves atomically with retry protection. Uploaded bytes stay out of app storage; confirmed nutrition snapshots and provenance are retained. No new environment values or database migration are required. Builds and runtime checks were not run, following the owner's request.

## Groq provider setup

Add **`GROQ_API_KEY`** to Vercel Production and the ignored root `.env`, then deploy this version. Automatic selection prefers Groq when both provider keys exist. You can keep the Gemini key as an explicitly selectable alternative; `AI_PROVIDER=gemini` switches back after redeployment. Provider errors never silently send photos to another service. No new dependency, storage service, or migration is needed.

The adapter uses Groq's documented OpenAI-compatible endpoint, image inputs, strict JSON schemas, and Qwen instruct mode (`reasoning_effort=none`). Server validators, signed owner-bound food drafts, immutable nutrition snapshots, private reusable foods, the shared account quota, and explicit plan approval remain required. Original model names stay attached to historical estimates. New run metadata records the selected provider and model.

Groq requests are kept compact: food output is capped at 2,048 tokens; meal planning uses up to 40 eligible candidates, brief notes, at most two items per meal, and 3,500 output tokens. Workout prompts omit redundant technique/rest descriptions from the candidate list; full reviewed definitions remain in server validation and exercise UI. The full searchable food catalog is unchanged. Provider request/token limits still apply, and large plans can be rejected or fail validation. The app's separate account limit defaults to 10 AI operations per rolling 24 hours.

The owner reported configuring the key locally and in Vercel. No build, typecheck, browser checks, or live inference were run for this switch, following the instruction to finish without checks. Availability, latency, extraction quality, and live quota behavior remain unverified. See [Decision 0013](docs/decisions/0013-groq-provider.md) and the [environment guide](docs/ENVIRONMENT.md).

## If AI estimates are unavailable

Text/food photos and cardio photos share a maximum 40-second provider deadline. Connection failures and HTTP 500/502/503/504 receive at most one retry after a short randomized delay, within that same deadline. Authentication, malformed requests, quota/rate limits, and invalid model output are not retried. There is no automatic model/provider switch. This transport retry does not save a food or activity; explicit review and confirmation remain required. One account operation may make two provider requests, so upstream usage can be higher than the account operation count. Stored token/cost figures reflect the returned response; failed attempts may have unreported usage.

The UI distinguishes provider busy/errors, connection failure, timeout, missing configuration, and quota limits. Retry diagnostics log only event/status/attempt, without prompts, photos, keys, or account identifiers. A generic completion failure can still originate outside the provider; the message alone does not prove an outage. Manual database food logging remains available. No new environment values or migrations are required. Build, typecheck, runtime checks, and live inference remain skipped at the owner's request; reading saved sanitized failure records for diagnosis is not a live inference check.

## Run locally

### Requirements

- Node.js 22.13 or later and npm 10 or later
- A Neon Postgres database (or another PostgreSQL instance supported by the schema)

Install dependencies and configure the server environment:

```bash
npm install
cp .env.example .env
```

Fill `DATABASE_URL`, your chosen `AUTH_SECRET`, `AUTH_BASE_URL`, and `AUTH_TRUSTED_ORIGINS` in the ignored root `.env`. For local use, both auth origins are `http://localhost:3000`. If you still need to create an auth secret, generate one with `openssl rand -base64 32`. Do not put server secrets in browser-visible variables.

For AI features, add `GROQ_API_KEY` in the ignored local `.env` and Vercel Production settings. Groq is selected automatically whenever its key is present, using the pinned image/text model `qwen/qwen3.8-27b`; no additional settings are required. Optional `AI_PROVIDER=groq` explicitly selects it. `GROQ_MODEL` accepts that supported model only. A previously configured Gemini `AI_MODEL` does not override the Groq model.

For an operator-selected Gemini alternative, set `AI_PROVIDER=gemini`, supply `GEMINI_API_KEY`, and use `AI_MODEL=gemini-3.1-flash-lite`. There is no automatic cross-provider fallback. If an explicitly selected provider has no key, AI features report unavailable; manual tracking remains usable. Google sign-in and Calendar keep using their separate Google OAuth credentials. OpenRouter credentials are not used.

Apply the application and isolated LangGraph checkpoint migrations once, then start Next.js:

```bash
npm run db:migrate
npm run dev
```

Open `http://localhost:3000` in a browser. To check the phone layout on your local network, start Next.js on all interfaces:

```bash
npm run dev -- --hostname 0.0.0.0
```

Open the computer's LAN address on the Android phone. Local use requires the computer and phone to share a network; deployed use does not.

## Deploy and install the PWA (no APK required)

1. Push the reviewed source to your GitHub repository. Never commit `.env` or credentials.
2. In Vercel, import the repository and select `apps/web` as the project root. Keep the detected Next.js framework and npm workspace installation/build settings.
3. Add the server environment variables from [the environment guide](docs/ENVIRONMENT.md) in Vercel **before the production build**. Set `AUTH_BASE_URL` and `AUTH_TRUSTED_ORIGINS` to the exact HTTPS domain you plan to use, such as `https://your-project.vercel.app`.
4. Run the database migrations once against the Neon database before using the app. See the environment guide for the command and safe options.
5. Deploy and verify the production HTTPS URL. Vercel handles later web deployments from the connected Git branch.
6. Open that HTTPS URL in Chrome on Android and choose **Add to Home screen** or **Install app**. Any verified Google account can sign up; email/password sign-up uses private invitation codes.

The PWA is the simplest phone installation path: there is no Expo account, APK build, Play Store, or separate API host. The initial setup still needs Vercel environment variables and a one-time Neon migration. After setup, pushing a web change to the connected branch triggers a Vercel deployment; it does not require rebuilding an APK.

Vercel hosts both the pages and `/api/*` and `/v1/*` server routes, so no separate API host or laptop server is needed. Neon remains a separate hosted database. Keep `DATABASE_URL`, `AUTH_SECRET`, and `GROQ_API_KEY` (or the selected provider’s key) in Vercel's server environment only. Do not use a Neon Data API URL in place of the Postgres connection URL for this app.

## Optional: build a private Android APK

Use this only if you prefer a separately installed Android package. The APK is a thin Expo WebView shell that opens the same hosted PWA; it does not run the backend on your phone or laptop.

1. Deploy and verify the PWA using the steps above.
2. Create or sign in to an Expo account. From `apps/mobile`, run `npx eas-cli@latest init` once if this app is not linked to an EAS project yet.
3. In the EAS project's **production** environment, set only `EXPO_PUBLIC_APP_URL` to the public Vercel origin. This public URL is packaged into the WebView shell; do not put Neon or Gemini credentials in the mobile app.
4. From `apps/mobile`, run `npm run build:apk`. Download the resulting APK from the private EAS build page and share it privately. Friends install it directly on Android; no Play Store account is involved.

Vercel web deployments update the content inside an installed APK. Changes to the native shell require a new APK. Browser notifications are optional and checked while the PWA is open; they are not scheduled background alarms. The WebView shell does not provide direct Health Connect integration or reliable background step collection. Steps can be entered manually. After Google OAuth is configured, Settings can sync approved workouts to a separate app-created calendar.

## Email/password invitations

New email/password accounts use an email-bound invitation code. Google sign-up is open to any verified Google account. Create one with the repository command configured to use the intended Neon database:

```bash
npm run invite:create -- --email friend@example.com
```

Share the one-time code privately. Do not place it in source control or public issue trackers.

## Seed the shared food catalog

The maintainer can import USDA's generic Food and Nutrient Database for Dietary Studies (FNDDS) records into Neon once. Everyday searches and food logs then use Neon rather than calling USDA. See [the catalog import and review instructions](docs/ENVIRONMENT.md#curating-shared-catalog-foods); downloaded data stay in `/tmp` and do not belong in Git.

## Checks

From the repository root:

```bash
npm run typecheck
npm run lint
npm run build
```

## Public-repository safeguards

This GitHub repository is public. It must contain source and documentation only, never API keys, database credentials, auth secrets, user health records, or private meal photos. `.env.example` contains blank secret placeholders; real values belong in the ignored `.env` locally and in Vercel's encrypted environment settings for deployment.

Enable the repository hooks on a new clone:

```bash
sh scripts/setup-git-hooks.sh
```

The hooks check staged changes for ignored files and secrets and enforce Conventional Commit subjects. Stage explicit paths and review `git diff --cached` before committing.

## Current implementation status

The repository contains the Next.js PWA and same-origin Hono API, plus an optional Expo WebView shell configured for an internal Android APK. The web app includes open Google sign-in and invite-gated email/password accounts, onboarding and versioned goals, body-weight and exercise-specific progress graphs, personal food search/creation with aliases, sourced shared serving weights and private household portions, per-account favorites and recents, versioned food-log edits and deletion, manual activity tracking, editable strength-session logs with date-selectable history and timed holds, a 47-exercise starter catalog, three starter workout templates, persistent reviewed weekly workout plans, timezone-aware daily summaries, food-day completion markers, a local USDA import and review CLI, and user-confirmed meal and nutrition estimates from photos. The configured Neon catalog contains 5,431 generic USDA foods and 22,118 portion references for manual logging; 33 of these foods have been source-checked and reviewed for general AI meal plans, with 92 USDA serving references; the other 5,398 remain unreviewed and excluded from AI planning. Neon has no dietary/allergen safety reviews yet, so constrained meal plans currently fail closed. Photo files are compressed in the browser, sent to the authenticated server-side AI provider call, and not saved to the food log. Reminder preferences are stored per account; browser notifications are opt-in and checked while the PWA is open. Settings supports a private JSON export and account deletion confirmed by a password or a recent sign-in, including planning checkpoint cleanup. AI requests share a configurable per-account rolling 24-hour quota, with provider token counts and reported USD costs recorded. Google sign-in and optional Calendar OAuth still need live callback/provider verification. Broader Indian-food coverage, two-account isolation checks, backup/restore, Vercel deployment, EAS project linking, and a signed APK build remain phased work. The configured Neon database has the auth, application, and LangGraph schemas. A read-only inventory confirmed forced RLS and one policy on all 18 public tables with a user or owner ID; runtime two-account isolation and restore checks are still pending. See [the environment guide](docs/ENVIRONMENT.md): Vercel serves the app and API, Neon stores its data, and EAS builds the Android wrapper; a laptop is not required to keep the deployed app available.
