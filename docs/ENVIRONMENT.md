# Environment setup

The app is a Next.js PWA on Vercel with a Neon Postgres database. The same Next.js deployment serves the UI and API. Your laptop runs the development server and database migrations; it is not the production backend.

## Local development

Copy the root example file and fill it in locally:

```bash
cp .env.example .env
```

For local development, use:

| Variable | Local value | Where it comes from |
| --- | --- | --- |
| `DATABASE_URL` | Neon Postgres connection string with SSL; use the pooled connection for the app | Neon Console → project → **Connect** → pooled connection string. This is private server configuration. |
| `AUTH_SECRET` | Your chosen private auth secret, at least 32 characters | Keep it private and stable. If you still need one, generate it with `openssl rand -base64 32`. |
| `AUTH_BASE_URL` | `http://localhost:3000` | Local Next.js origin. For deployed production, use the exact HTTPS Vercel/custom domain. |
| `AUTH_TRUSTED_ORIGINS` | `http://localhost:3000` | The exact origin allowed to use auth. Separate multiple origins with commas. |

The app does not need `EXPO_PUBLIC_API_BASE_URL` or any browser-visible secret. The browser calls relative same-origin routes such as `/api/auth/*` and `/v1/*`.

Run the auth, application, and LangGraph checkpoint migrations once, then launch the app:

```bash
npm run db:migrate
npm run dev
```

## Vercel deployment

In the Vercel project settings, add server-side Environment Variables for the **Production** environment before deploying. Set these to the production Neon database and the chosen stable app domain:

```text
DATABASE_URL=<Neon pooled Postgres connection string>
AUTH_SECRET=<your chosen private auth secret>
AUTH_BASE_URL=https://your-project.vercel.app
AUTH_TRUSTED_ORIGINS=https://your-project.vercel.app
NODE_ENV=production
```

Replace the example domain with the real Vercel project domain or your custom domain. If you change domains, update both auth values and redeploy. Add matching values to Vercel's Preview environment only if you intend to test authentication on preview deployments; allow only the exact preview origin being used.

Set values in **Vercel → Project → Settings → Environment Variables**; do not put them in source files, GitHub Actions logs, or client `NEXT_PUBLIC_*` variables. Vercel hosts the site and Next.js server routes, so there is no separate API URL to configure. Neon hosts the data, so `DATABASE_URL` remains necessary.

### Database migrations

Apply migrations from a trusted local checkout before using a newly deployed app. Your local root `.env` must point to the intended Neon database. Run:

```bash
npm run db:migrate
```

The command applies Better Auth and Drizzle application migrations, then prepares the official LangGraph checkpoint tables in the isolated `langgraph` schema. Review migration files before running them against production. Do not automatically run schema migrations as part of every Vercel build.

Migration `0010_account_privacy.sql` forces row-level security on personal food, food-day status, plan, and AI-run tables and adds the user-delete cascades required by account deletion. Migration `0011_food_favorites.sql` adds account-scoped favorites. Migration `0012_food_portions_aliases.sql` adds catalog aliases and account-scoped household portions. Both user-specific tables use forced row-level security and user-delete cascades. Apply the full migration set before using these features. The account-deletion endpoint checks that the expected constraints and protections exist before calling Better Auth; otherwise it returns an error without deleting the account.

### Friend access

The app uses invitation-based signup. Create a one-time code for each friend with the CLI while the local root `.env` points at the same production Neon database:

```bash
npm run invite:create -- --email friend@example.com
```

Share the code and app URL privately. Never send a friend `DATABASE_URL`, `AUTH_SECRET`, or the OpenRouter key.

## Feature-specific configuration

| Feature | Variables | When to configure |
| --- | --- | --- |
| Food photo suggestions and meal-plan generation | `OPENROUTER_API_KEY`; optional `AI_MODEL` (defaults to `minimax/minimax-m3`) | Add the OpenRouter key to Vercel as a server-only Production variable to enable AI. Manual tracking works without it. The app calls OpenRouter's standard endpoint and keeps image and output size limits in server code. |
| Durable background AI jobs | `JOB_DISPATCH_SECRET` | Configure only when a separate authenticated worker/dispatcher is deployed. Generate with `openssl rand -hex 32`. |
| Private food-photo storage | `STORAGE_PROVIDER`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_FORCE_PATH_STYLE`, `UPLOAD_MAX_BYTES` | Configure after selecting a private S3-compatible storage provider. Keep credentials server-only; use short-lived upload permissions and retention cleanup. |
| Google Calendar connection and workout sync | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` | Optional. The integration is implemented; configure these only if you want Calendar sync. Keep all four values server-side. |
| Curated catalog imports | `USDA_API_KEY` | Optional; needed only for individual USDA search/import commands. The bulk FNDDS seed reads a locally downloaded public dataset and does not need this key. Neither is needed by the deployed app; do not add the key to Vercel. |
| Email verification/password recovery | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` | Add after choosing an email provider and implementing those email flows. |

The LangGraph checkpoint store uses `DATABASE_URL`; it does not need a separate database URL. Leave unused integration values empty. Per-user AI quotas and daily cost limits are not implemented yet. The meal-plan screen currently supports review, portion edits, approval, rejection, and history; it does not support food swaps yet. Generation pauses when a profile has diet preferences or restrictions because the catalog does not yet store reviewed diet/allergen tags. Do not use generated plans for a restricted diet until that catalog support is completed.

### Optional Google Calendar setup

Calendar sync uses the OAuth 2.0 web server flow and the narrow `calendar.app.created` scope. It creates a separate **Goal Health Workouts** calendar and only syncs the user's approved active workout plan. It does not read or edit the user's other calendars. Sync runs when the user presses **Sync approved workouts** in Settings and reconciles the next 28 days. Each event gets a 30-minute popup reminder. Existing events remain in Google Calendar after disconnect; disconnect removes the stored refresh token and attempts to revoke it.

1. In Google Cloud Console, create or select a project, enable the Google Calendar API, and create an OAuth client for a web application.
2. Add this exact authorized redirect URI for local use: `http://localhost:3000/v1/connections/google/callback`. For Vercel, use `https://YOUR-APP-DOMAIN/v1/connections/google/callback` with the deployed domain.
3. Copy the OAuth client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Set `GOOGLE_REDIRECT_URI` to the same exact URI registered in Google Cloud.
4. Generate `TOKEN_ENCRYPTION_KEY` with `openssl rand -hex 32`. This key encrypts Google refresh tokens in Neon. Keep a secure backup of it: changing the key makes previously stored tokens unreadable.
5. Put the four values in the local ignored `.env` or Vercel's server-only environment settings, then redeploy Vercel. Never add a `NEXT_PUBLIC_` prefix.
6. In Google OAuth consent settings, add the accounts that will test the app if the OAuth app is still in testing. Sign into Goal Health, open Settings, connect Calendar, then sync an approved workout plan.

The app requests `https://www.googleapis.com/auth/calendar.app.created`, which Google documents as allowing the app to create secondary calendars and manage events on those calendars. The server requests offline access and encrypts the refresh token at rest. See Google's [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [web server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server), and [Calendar reminders](https://developers.google.com/workspace/calendar/api/concepts/reminders).

### Export and account deletion

In Settings, each user can download an account-scoped JSON export or request deletion after entering their current password and typing `DELETE`. The export includes app profile, tracking history, saved plans, AI planning history, reminder settings, safe Calendar metadata, and temporary-upload metadata; it excludes authentication credentials and Google tokens. Deletion removes account-owned Neon rows and LangGraph planning checkpoints and attempts to revoke Google access. A Google calendar created by the app and its events can remain in the user's Google account, so the user may remove that calendar there. Neon backup snapshots follow the retention settings on the Neon project and are not immediately erased by app account deletion; choose and document a retention period before inviting users to production.

PWA browser reminders need no additional environment variables. They require notification permission and are checked while Goal Health is open; they are not reliable alarms when Android closes the PWA.

### Curating shared catalog foods

The app does not call a nutrition provider whenever someone logs a meal. A maintainer can search FoodData Central, import a generic entry as an unpublished draft, review its values, then publish it to the shared catalog:

```bash
npm run catalog:search -- --query "cooked lentils"
npm run catalog:import -- --fdc-id <id-from-search> --category ingredient
npm run catalog:publish -- --food-id <catalog-id-printed-by-import>
npm run catalog:aliases -- --food-id <catalog-id> --aliases "dosai, thosai"
```

Use only a matching generic Foundation, SR Legacy, or Survey food. Check the description and per-100-g calories/macros before publishing. Imports remain invisible to food search until published. Aliases are search labels only and do not change nutrition data. USDA FoodData Central data are CC0/public domain; keep attribution and the FDC ID in the catalog. The Indian Food Composition Tables have separate reuse restrictions: their official publication prohibits storing/reproducing the data electronically for a product without prior written permission. Do not bulk-import IFCT values without that permission. [USDA API and license](https://fdc.nal.usda.gov/api-guide/) · [ICMR-NIN IFCT 2017 terms](https://www.nin.res.in/ebooks/IFCT2017_16122024.pdf)

To seed a larger generic food catalog without making one API call per food, download USDA's FNDDS 2021–2023 JSON archive and extract its `surveyDownload.json` outside the repository:

```bash
curl -fL -o /tmp/healthcare-fndds.zip https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip
unzip -p /tmp/healthcare-fndds.zip surveyDownload.json > /tmp/surveyDownload.json
npm run catalog:seed:fndds -- --file /tmp/surveyDownload.json --dry-run
npm run catalog:seed:fndds -- --file /tmp/surveyDownload.json
```

The import validates the FNDDS data type, FDC IDs, and the four required macro values, skips records missing or outside the app's safety bounds, and is idempotent by source and FDC ID. It imports generic FNDDS foods for manual search/logging as **not reviewed**; AI meal-plan generation continues to use reviewed entries only. The importer adds search aliases for selected Indian dishes (such as idli, dosa, dal, roti, and biryani), but FNDDS is a US dietary-survey dataset, not a complete Indian food table. Use personal foods for household recipes or items whose values differ, and extend the shared catalog only with checked, sourced entries. The archive is about 3.7 MB compressed; the extracted file is temporary, contains no user data, and should not be committed. USDA data are CC0 and should remain attributed to FoodData Central. See [USDA's download page](https://fdc.nal.usda.gov/download-datasets/).

## Phone and PWA behavior

During local development, use the computer's LAN address from the phone and set local auth origins accordingly. For everyday use by friends on other networks, use the deployed HTTPS Vercel URL. Opening that URL works in Android Chrome; users can choose **Add to Home screen** to launch it like an app.

This PWA has one public origin, so no `EXPO_PUBLIC_API_BASE_URL`, separate backend URL, native app identifier, or APK build is needed. Browser/PWA access does not provide direct Health Connect integration or dependable background step collection. Keep steps manually editable unless a separate native Android companion is built later.
