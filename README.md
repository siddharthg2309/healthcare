# Goal Health

A private, Android-first health and fitness app for food logging, activity tracking, and measured progress toward personal goals. The app UI and API are a Next.js PWA deployed to Vercel. A small Expo Android app can load that same hosted app in a WebView and be shared privately as an APK; the PWA URL also remains usable in Chrome. **No Play Store listing is required.**

The app and API are served by one Next.js project. Vercel hosts the web UI and server-side API routes; Neon provides the cloud Postgres database. Your laptop is needed for development and the one-time database migration, not for friends to use the deployed app.

The app is under implementation. The current build includes account setup, goal onboarding, the target-versus-weigh-in graph, personal food search and creation, a recipe builder with server-calculated macros, cooking instructions, and immutable version history, editable food logs, manual activity logging, daily nutrition summaries, food-day completion status, tools to seed generic USDA survey foods and curate additional entries, and photo-based food-name suggestions. The person still selects a catalog entry and enters the amount before logging. Meal and workout plans use bounded LangGraph workflows with editable drafts, deterministic checks, explicit review, approval/rejection, and history; meal-plan drafts support catalog food swaps with server-recalculated nutrition. Approved workout sessions link to the activity log only after the person records the work completed. Reminder preferences are saved per account, and optional browser notifications are checked while the PWA is open. Optional Google Calendar OAuth and one-way approved-workout sync are implemented and require server credentials. Broader Indian-food coverage, reviewed dietary/allergen tags, live deployment, and device integrations remain planned. See the [implementation plan](docs/IMPLEMENTATION_PLAN.md) for the phased scope and [environment setup](docs/ENVIRONMENT.md) for deployment steps.

## Stack

- Next.js App Router, React, and TypeScript, deployed as a PWA on Vercel
- Optional Expo Android WebView shell, built as an internal APK with EAS and configured with the public Vercel app URL
- Minimal black, white, gray, and lime-green visual system with Manrope
- Same-origin Next.js Route Handlers dispatching to the modular Hono API
- Neon Postgres with Drizzle migrations; Better Auth for invite-gated accounts
- Server-only OpenRouter integration using MiniMax M3 for food-photo candidates and meal/workout plans; only the OpenRouter key is required, with the model defaulted in the server
- Two bounded LangGraph workflows for meal and workout plans, with database-backed state and explicit user review

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
6. Open that HTTPS URL in Chrome on Android and choose **Add to Home screen** or **Install app**. Sign in and share the URL and invite codes privately with friends.

The PWA is the simplest phone installation path: there is no Expo account, APK build, Play Store, or separate API host. The initial setup still needs Vercel environment variables and a one-time Neon migration. After setup, pushing a web change to the connected branch triggers a Vercel deployment; it does not require rebuilding an APK.

Vercel hosts both the pages and `/api/*` and `/v1/*` server routes, so no separate API host or laptop server is needed. Neon remains a separate hosted database. Keep `DATABASE_URL`, `AUTH_SECRET`, and `OPENROUTER_API_KEY` in Vercel's server environment only. Do not use a Neon Data API URL in place of the Postgres connection URL for this app.

## Optional: build a private Android APK

Use this only if you prefer a separately installed Android package. The APK is a thin Expo WebView shell that opens the same hosted PWA; it does not run the backend on your phone or laptop.

1. Deploy and verify the PWA using the steps above.
2. Create or sign in to an Expo account. From `apps/mobile`, run `npx eas-cli@latest init` once if this app is not linked to an EAS project yet.
3. In the EAS project's **production** environment, set only `EXPO_PUBLIC_APP_URL` to the public Vercel origin. This public URL is packaged into the WebView shell; do not put Neon or OpenRouter credentials in the mobile app.
4. From `apps/mobile`, run `npm run build:apk`. Download the resulting APK from the private EAS build page and share it privately. Friends install it directly on Android; no Play Store account is involved.

Vercel web deployments update the content inside an installed APK. Changes to the native shell require a new APK. Browser notifications are optional and checked while the PWA is open; they are not scheduled background alarms. The WebView shell does not provide direct Health Connect integration or reliable background step collection. Steps can be entered manually. After Google OAuth is configured, Settings can sync approved workouts to a separate app-created calendar.

## Friend invitations

New accounts use an email-bound invitation code. Create one with the repository command configured to use the intended Neon database:

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

The repository contains the Next.js PWA and same-origin Hono API, plus an optional Expo WebView shell configured for an internal Android APK. The web app includes invitation-based authentication, onboarding and versioned goals, body-weight and exercise-specific progress graphs, personal food search/creation with aliases, private household portions, per-account favorites and recents, versioned food-log edits and deletion, manual activity tracking, editable strength-session logs with date-selectable history and timed holds, a 47-exercise starter catalog, three starter workout templates, persistent reviewed weekly workout plans, timezone-aware daily summaries, food-day completion markers, a local USDA import and review CLI, and user-confirmed food-name suggestions from photos. Photo files are compressed in the browser, sent to the authenticated server-side OpenRouter call, and not saved to the food log. Reminder preferences are stored per account; browser notifications are opt-in and checked while the PWA is open. Settings supports a private JSON export and password-confirmed account deletion, including planning checkpoint cleanup. AI requests share a configurable per-account rolling 24-hour quota, with provider token counts and reported USD costs recorded. Optional Calendar OAuth and approved-workout sync still need live provider verification. Broader food-catalog review, production Neon migrations, two-account isolation checks, backup/restore, Vercel deployment, EAS project linking, and a signed APK build remain phased work. See [the environment guide](docs/ENVIRONMENT.md): Vercel serves the app and API, Neon stores its data, and EAS builds the Android wrapper; a laptop is not required to keep the deployed app available.
