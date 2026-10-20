# Goal Health

A private, Android-first health and fitness app for food logging, activity tracking, and measured progress toward personal goals. It is a responsive Next.js Progressive Web App (PWA): deploy it to Vercel, share the HTTPS link with invited friends, and optionally add it to an Android home screen. **No APK or Play Store listing is required.**

The app and API are served by one Next.js project. Vercel hosts the web UI and server-side API routes; Neon provides the cloud Postgres database. Your laptop is needed for development and the one-time database migration, not for friends to use the deployed app.

The app is under implementation. The current build includes account setup, goal onboarding, the target-versus-weigh-in graph, personal food creation and search, editable food logs, manual activity logging, daily nutrition summaries, food-day completion status, a local workflow to import/review/publish generic USDA foods, and photo-based food-name suggestions. The person still selects a catalog entry and enters the amount before logging. Meal and workout plans use bounded LangGraph workflows with editable drafts, deterministic checks, explicit review, approval/rejection, and history. Approved workout sessions link to the activity log only after the person records the work completed. Reminder preferences are saved per account, and optional browser notifications are checked while the PWA is open. Optional Google Calendar OAuth and one-way approved-workout sync are implemented and require server credentials. Reviewed dietary/allergen tags, broader Indian-food catalog coverage, food swaps, recipes, live deployment, and device integrations remain planned. See the [implementation plan](docs/IMPLEMENTATION_PLAN.md) for the phased scope and [environment setup](docs/ENVIRONMENT.md) for deployment steps.

## Stack

- Next.js App Router, React, and TypeScript, deployed as a PWA on Vercel
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

## Deploy to Vercel and use on Android

1. Push the source to your GitHub repository. Never commit `.env` or credentials.
2. In Vercel, import the repository and select `apps/web` as the project root. Keep the detected Next.js framework and npm workspace installation/build settings.
3. Add the server environment variables from [the environment guide](docs/ENVIRONMENT.md) in Vercel **before the production build**. Set `AUTH_BASE_URL` and `AUTH_TRUSTED_ORIGINS` to the exact HTTPS domain you plan to use, such as `https://your-project.vercel.app`.
4. Run the database migrations once against the Neon database before using the app. See the environment guide for the command and safe options.
5. Deploy. Vercel provides the public HTTPS URL and handles subsequent deployments from the connected Git branch.
6. Open the URL on Android Chrome. Use Chrome's menu → **Add to Home screen** (or **Install app**, when offered). Friends open the same URL, create an account with their invitation, and can add it the same way.

Vercel hosts both the pages and `/api/*` and `/v1/*` server routes, so no separate API host or laptop server is needed. Neon remains a separate hosted database. Keep `DATABASE_URL`, `AUTH_SECRET`, and `OPENROUTER_API_KEY` in Vercel's server environment only. Do not use a Neon Data API URL in place of the Postgres connection URL for this app.

The PWA supports food logging, photo upload, plans, reminder preferences, and the goal graph. Browser notifications are optional and checked while the app is open; they are not scheduled background alarms. Direct Health Connect integration and reliable background step collection are not available in this PWA. Steps can be entered manually. After Google OAuth is configured, Settings can sync approved workouts to a separate app-created calendar.

## Friend invitations

New accounts use an email-bound invitation code. Create one with the repository command configured to use the intended Neon database:

```bash
npm run invite:create -- --email friend@example.com
```

Share the one-time code privately. Do not place it in source control or public issue trackers.

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

The repository contains the Next.js PWA and same-origin Hono API, invitation-based authentication, onboarding and versioned goals, body-weight and exercise-specific progress graphs, personal food search/creation with aliases, private household portions, per-account favorites and recents, versioned food-log edits and deletion, manual activity tracking, editable strength-session logs with date-selectable history and timed holds, a 47-exercise starter catalog, three starter workout templates, persistent reviewed weekly workout plans, timezone-aware daily summaries, food-day completion markers, a local USDA import and review CLI, and user-confirmed food-name suggestions from photos. Photo files are compressed in the browser, sent to the authenticated server-side OpenRouter call, and not saved to the food log. Reminder preferences are stored per account; browser notifications are opt-in and checked while the PWA is open. Settings supports a private JSON export and password-confirmed account deletion, including planning checkpoint cleanup. Optional Calendar OAuth and approved-workout sync still need live provider verification. Broader food-catalog review, production Neon migrations, two-account isolation checks, backup/restore, and Vercel deployment remain phased work. See [the environment guide](docs/ENVIRONMENT.md): Vercel serves the PWA and API, while Neon stores its data; a laptop is not required to keep the deployed app available.
