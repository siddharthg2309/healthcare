# Environment setup

The app UI and API are a Next.js PWA on Vercel with a Neon Postgres database. A thin Expo Android shell can load that hosted app and be built as a private APK with EAS. Your laptop runs development and reviewed migrations; it is not the production backend.

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

The browser calls relative same-origin routes such as `/api/auth/*` and `/v1/*`. The database client makes legacy PostgreSQL `sslmode=prefer`, `require`, or `verify-ca` values explicit as `verify-full`, preserving certificate and host verification across driver upgrades. The optional APK shell needs only the public `EXPO_PUBLIC_APP_URL` at build time; it loads the same web app and API in a WebView. Never place credentials in `EXPO_PUBLIC_*` variables.

Run the auth, application, and LangGraph checkpoint migrations once, then launch the app:

```bash
npm run db:migrate
npm run dev
```

## Vercel deployment

Import `siddharthg2309/healthcare` from GitHub as one Vercel project. In the import/build settings:

- Set **Framework Preset** to **Next.js** and **Root Directory** to `apps/web`.
- Enable **Include source files outside of the Root Directory in the Build Step**. The web app imports the Hono backend and shared npm workspaces from elsewhere in this repository.
- Keep the npm install/build defaults. The web workspace build command is `npm run build`; leave the Next.js output directory at its default.

See Vercel's [monorepo setup](https://vercel.com/docs/monorepos) and [build settings](https://vercel.com/docs/builds/configure-a-build) for these project options.

In the Vercel project settings, add server-side Environment Variables for the **Production** environment before deploying. Set these to the production Neon database and the chosen stable app domain. Keep these variables Production-only for the first deployment; Preview deployments need their own matching auth origin if enabled later.

```text
DATABASE_URL=<Neon pooled Postgres connection string>
AUTH_SECRET=<your chosen private auth secret>
AUTH_BASE_URL=https://your-project.vercel.app
AUTH_TRUSTED_ORIGINS=https://your-project.vercel.app
GROQ_API_KEY=<your Groq API key>
```

Local `.env` values are ignored by Git and are not copied into Vercel. Use your existing private Neon URL and auth secret. `GROQ_API_KEY` selects Groq automatically and enables text/photo food estimates, cardio photo reading, and both AI planners. `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are optional; add them after deployment if you want Google sign-in. Use the exact HTTPS origin with no path or trailing slash in both auth URL variables. If you change domains, update both values and redeploy. Add matching values to Vercel's Preview environment only if you intend to test authentication on preview deployments; allow only the exact preview origin being used.

Vercel assigns a default `.vercel.app` domain based on the project name when the project is deployed. Use the domain you expect Vercel to assign in both auth variables, then verify the actual value under **Project → Settings → Domains**. If it differs, update `AUTH_BASE_URL` and `AUTH_TRUSTED_ORIGINS` to the assigned HTTPS origin and redeploy before testing sign-in or inviting friends. Do not import a local `.env` unchanged when its auth URLs point to localhost. See Vercel's [domain assignment guide](https://vercel.com/docs/domains/working-with-domains).

Set values in **Vercel → Project → Settings → Environment Variables**; do not put them in source files, GitHub Actions logs, or client `NEXT_PUBLIC_*` variables. Vercel hosts the site and Next.js server routes, so there is no separate API URL to configure. Neon hosts the data, so `DATABASE_URL` remains necessary.

### Database migrations

Apply migrations from a trusted local checkout before using a newly deployed app. Your local root `.env` must point to the intended Neon database. Run:

```bash
npm run db:migrate
```

The command applies Better Auth and Drizzle application migrations, then prepares the official LangGraph checkpoint tables in the isolated `langgraph` schema. Review migration files before running them against production. Do not automatically run schema migrations as part of every Vercel build.

Migration `0010_account_privacy.sql` forces row-level security on personal food, food-day status, plan, and AI-run tables and adds the user-delete cascades required by account deletion. Migration `0011_food_favorites.sql` adds account-scoped favorites. Migration `0012_food_portions_aliases.sql` adds catalog aliases and account-scoped household portions. Migration `0017_catalog_food_safety_reviews.sql` adds reviewed diet/allergen metadata, and `0018_catalog_food_portions.sql` adds source-attributed default serving weights for shared foods. User-specific tables use forced row-level security and user-delete cascades. Apply the full migration set before using these features. The account-deletion endpoint checks that the expected constraints and protections exist before calling Better Auth; otherwise it returns an error without deleting the account.

### Friend access

Email/password sign-up uses invitations; any verified Google account can create an account. Create a one-time code for each friend with the CLI while the local root `.env` points at the same production Neon database:

```bash
npm run invite:create -- --email friend@example.com
```

Share the code and app URL privately. Never send a friend `DATABASE_URL`, `AUTH_SECRET`, or the Gemini key.

## Install the PWA on Android (no APK required)

After the Vercel and Neon setup above, open the deployed HTTPS app URL in Chrome on the Android phone. In Chrome's menu, choose **Add to Home screen** or **Install app** (wording can vary by Chrome version), then launch Goal Health from the new home-screen icon. Share the app URL; share email/password invitation codes privately.

This install path uses the Next.js PWA directly. It does not need an Expo account, EAS, a native build, or a Play Store listing. After the first deployment, pushing a web change to the Vercel-connected branch redeploys the app automatically. The one-time Vercel configuration and Neon migration are still required; your laptop does not host the live app.

## Optional private Android APK

Choose this only if you want a separate Android package. The APK is an Expo WebView shell around the same hosted PWA, not a separate backend or a requirement for phone use. Deploy and verify Vercel first. The APK requires the HTTPS origin because it loads the hosted UI and API; cloud logging cannot work while Vercel or Neon is unavailable. EAS cloud builds run remotely, so local Android Studio and Xcode are not needed for this APK path. An Expo Doctor warning about the local Xcode version does not block an Android cloud build. See Expo’s [cloud workflow overview](https://docs.expo.dev/workflow/overview/) and [EAS build infrastructure](https://docs.expo.dev/build/introduction/).

### One-time EAS setup

1. Create or sign in to an Expo account.
2. From `apps/mobile`, run `npx eas-cli@latest init` to link the app to your EAS project. This adds the public project ID to `apps/mobile/app.json`.
3. In the Expo dashboard, open the project's **production** environment variables and add:

   | Variable | Value | Visibility |
   | --- | --- | --- |
   | `EXPO_PUBLIC_APP_URL` | `https://your-project.vercel.app` | Plain text; this URL is packaged into the APK |

   These URLs are public configuration. Do not add Neon, Better Auth, Gemini, Google OAuth, storage, or token-encryption secrets to Expo/EAS or the APK.
4. Build an installable APK from `apps/mobile`:

   ```bash
   npm run build:apk
   ```

5. Let EAS manage Android signing credentials. Download the APK from the completed build and share it with intended users; any verified Google account can sign up. Recipients may need to allow installation from the browser or file app that downloaded it.

The repo ignores `.apk` files and signing material. The APK uses the deployed app URL at runtime. A Vercel web deployment updates the content for existing installs; changes to the wrapper, app identifier, or native permissions require another APK build. EAS internal-build URLs are bearer links, so do not post them publicly.

For local Android development, copy `apps/mobile/.env.example` to `apps/mobile/.env` and set `EXPO_PUBLIC_APP_URL` to your development machine's LAN address. Do not use `localhost` from a physical phone. The production EAS variable is independent of the ignored local file.

## Feature-specific configuration

| Feature | Variables | When to configure |
| --- | --- | --- |
| Text/photo food estimates, cardio photos, and meal/workout planning | `GROQ_API_KEY`; optional `GROQ_MODEL` (pinned to `qwen/qwen3.8-27b`); optional `AI_PROVIDER`; `AI_USER_DAILY_OPERATION_LIMIT` (default `10`) | A Groq key selects Groq automatically. Optional `AI_PROVIDER=gemini` selects `GEMINI_API_KEY` and Gemini `AI_MODEL` instead. All values are server-only. Manual tracking works without AI. Account quotas and image/output limits remain enforced. |
| Durable background AI jobs | `JOB_DISPATCH_SECRET` | Configure only when a separate authenticated worker/dispatcher is deployed. Generate with `openssl rand -hex 32`. |
| Private food-photo storage | `STORAGE_PROVIDER`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_FORCE_PATH_STYLE`, `UPLOAD_MAX_BYTES` | Configure after selecting a private S3-compatible storage provider. Keep credentials server-only; use short-lived upload permissions and retention cleanup. |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional. Enables sign-in and account creation for verified Google accounts. Keep both values server-side. |
| Google Calendar connection and workout sync | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` | Optional. Reuses the Google OAuth client above and additionally needs the Calendar API, its exact redirect URI, and the token-encryption key. Keep all four values server-side. |
| Curated catalog imports | `USDA_API_KEY` | Optional; needed only for individual USDA search/import commands. The bulk FNDDS seed reads a locally downloaded public dataset and does not need this key. Neither is needed by the deployed app; do not add the key to Vercel. |
| Email verification/password recovery | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` | Add after choosing an email provider and implementing those email flows. |

The LangGraph checkpoint store uses `DATABASE_URL`; it does not need a separate database URL. Leave unused integration values empty. The backend limits each account to 10 AI operations in a rolling 24-hour window across food-photo recognition and both planners. Configure `AI_USER_DAILY_OPERATION_LIMIT` in the server environment to change that cap (1–100; default 10). AI run rows retain status and token counts without storing uploaded photo bytes. When the selected provider does not return an exact per-call USD cost, cost remains null. This is a per-account request cap, not a shared dollar budget. Monitor the selected provider dashboard for actual usage and quotas; Google Cloud budget alerts are notifications, not a hard spending cap. Meal-plan drafts support catalog food swaps and portion edits; saving recalculates nutrition and revalidates plan ranges on the server. Plans use only published foods with reviewed safety metadata when diet/allergen requirements apply, and unsupported restrictions fail closed. The catalog may not yet have enough reviewed options for a useful plan. These tags do not guarantee allergy safety or prevent cross-contamination, so users must verify current labels and recipes.

### Groq setup and photo errors

1. Create a project key in [Groq Console](https://console.groq.com/keys).
2. Set the full key as **`GROQ_API_KEY`** in the ignored root `.env` and Vercel **Production** environment variables. Never use `NEXT_PUBLIC_`.
3. Deploy this code. Groq is selected automatically if the key is present; otherwise the existing Gemini configuration is selected. No change to the Google OAuth client, Neon URL, or auth secret is needed.
4. Optional: `AI_PROVIDER=groq` pins Groq explicitly. `GROQ_MODEL` defaults to the supported multimodal model `qwen/qwen3.8-27b`; no model setting is required.

An existing Gemini `AI_MODEL` does not affect Groq requests. Keep `GEMINI_API_KEY` if you want an operator-controlled alternative: set `AI_PROVIDER=gemini` and redeploy to use it with `AI_MODEL=gemini-3.1-flash-lite`. There is no automatic provider/model fallback. Missing credentials for an explicitly selected provider fail closed. The previous MiniMax default is still normalized for the Gemini option. `OPENROUTER_API_KEY` remains unused.

Groq receives image inputs through its [OpenAI-compatible endpoint](https://console.groq.com/docs/openai). The [selected model](https://console.groq.com/docs/model/qwen/qwen3.8-27b) supports image/text input and instruct mode; [strict JSON output](https://console.groq.com/docs/structured-outputs) is still validated by the application. One bounded transient retry for food/cardio operations remains inside their 40-second deadline. The bounded planners keep their own call and repair limits. Provider authentication/configuration and 429 quota errors do not trigger automatic retries or another provider.

The app has a separate default cap of 10 AI operations per account per rolling 24 hours, shared across estimates and plans. This is not the provider's project quota or a dollar budget. Groq's [limits](https://console.groq.com/docs/rate-limits) are shared by the organization; images consume tokens, and limits shown by the provider are not guaranteed capacity. Food output is capped at 2,048 tokens on Groq, meal planning sends up to 40 eligible candidates and caps output at 3,500 tokens, and workout candidates omit redundant prose. Larger plans can still exceed provider limits or fail validation. No paid fallback is configured by the app, but the provider account's actual billing plan controls its charges.

Estimates and bounded planning context go to the selected provider; uploaded photos stay out of app storage. Provider terms apply to its processing. Run metadata records provider/model, sanitized status, and returned usage without raw photos, API keys, or provider error bodies. See [Groq data handling](https://console.groq.com/docs/your-data); optional Gemini uses Google's [pricing/data-use terms](https://ai.google.dev/gemini-api/docs/pricing). Google OAuth credentials remain separate and continue to handle sign-in and Calendar.

No database migration or new dependency is needed. The owner supplied the key, but no builds, typecheck, browser checks, live inference, or runtime verification were run for this provider change, as requested.

### Optional Google sign-in setup

Google sign-in is enabled only when both OAuth client values are set. Any Google account with a verified email can create an account; Google sign-up does not require an app invitation. Email/password sign-up still requires a one-time invitation code. Existing email/password accounts can continue using their password; Better Auth requires the local email to be verified before it will automatically link a Google identity.

1. In Google Auth Platform, set the audience to **External**. To allow any Google account, set the publishing status to **In production**; Testing status can limit access to listed test users.
2. Create or select an OAuth client for a web application. Add this exact authorized redirect URI for local use: `http://localhost:3000/api/auth/callback/google`. For Vercel, also add `https://YOUR-APP-DOMAIN/api/auth/callback/google` using the deployed domain.
3. Put the client ID and client secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the ignored local `.env` or Vercel's server-only environment settings. Set the production `AUTH_BASE_URL` to the same deployed origin and redeploy. Do not add a `NEXT_PUBLIC_` prefix.
4. No app invitation is needed for Google sign-up. Use `npm run invite:create -- --email friend@example.com` only for email/password accounts. Never share server credentials.

No Calendar API, `GOOGLE_REDIRECT_URI`, or `TOKEN_ENCRYPTION_KEY` is needed for sign-in alone.

### Optional Google Calendar setup

Calendar sync uses the OAuth 2.0 web server flow and the narrow `calendar.app.created` scope. It creates a separate **Goal Health Workouts** calendar and only syncs the user's approved active workout plan. It does not read or edit the user's other calendars. Sync runs when the user presses **Sync approved workouts** in Settings and reconciles the next 28 days. Each event gets a 30-minute popup reminder. Existing events remain in Google Calendar after disconnect; disconnect removes the stored refresh token and attempts to revoke it.

1. In Google Cloud Console, create or select a project, enable the Google Calendar API, and create an OAuth client for a web application. You can reuse the client from Google sign-in.
2. Add this exact authorized redirect URI for local use: `http://localhost:3000/v1/connections/google/callback`. For Vercel, use `https://YOUR-APP-DOMAIN/v1/connections/google/callback` with the deployed domain. Keep the separate `/api/auth/callback/google` URI registered too if sign-in is enabled.
3. Copy the OAuth client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Set `GOOGLE_REDIRECT_URI` to the same exact URI registered in Google Cloud.
4. Generate `TOKEN_ENCRYPTION_KEY` with `openssl rand -hex 32`. This key encrypts Google refresh tokens in Neon. Keep a secure backup of it: changing the key makes previously stored tokens unreadable.
5. Put the four values in the local ignored `.env` or Vercel's server-only environment settings, then redeploy Vercel. Never add a `NEXT_PUBLIC_` prefix.
6. In Google OAuth consent settings, add the accounts that will test the app if the OAuth app is still in testing. Sign into Goal Health, open Settings, connect Calendar, then sync an approved workout plan.

The app requests `https://www.googleapis.com/auth/calendar.app.created`, which Google documents as allowing the app to create secondary calendars and manage events on those calendars. The server requests offline access and encrypts the refresh token at rest. See Google's [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [web server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server), and [Calendar reminders](https://developers.google.com/workspace/calendar/api/concepts/reminders).

### Export and account deletion

In Settings, each user can download an account-scoped JSON export or request deletion by typing `DELETE`. Email/password users may provide their password; Google-only users leave it blank and must have signed in during the last 24 hours. The export includes app profile, tracking history, saved plans, AI planning history, reminder settings, safe Calendar metadata, and temporary-upload metadata; it excludes authentication credentials and Google tokens. Deletion removes account-owned Neon rows and LangGraph planning checkpoints and attempts to revoke Google access. A Google calendar created by the app and its events can remain in the user's Google account, so the user may remove that calendar there. Neon backup snapshots follow the retention settings on the Neon project and are not immediately erased by app account deletion; choose and document a retention period before inviting users to production.

Browser reminders need no additional environment variables. In the web app they require notification permission and are checked while Goal Health is open; they are not reliable alarms when Android closes the PWA or WebView shell.

### Curating shared catalog foods

The app does not call a nutrition provider whenever someone logs a meal. A maintainer can search FoodData Central, import a generic entry as an unpublished draft, review its values, then publish it to the shared catalog:

```bash
npm run catalog:search -- --query "cooked lentils"
npm run catalog:import -- --fdc-id <id-from-search> --category ingredient
npm run catalog:publish -- --food-id <catalog-id-printed-by-import>
npm run catalog:publish -- --food-ids "<catalog-id-one>,<catalog-id-two>"
npm run catalog:aliases -- --food-id <catalog-id> --aliases "dosai, thosai"
```

The publish command prints each selected food, source record, and per-100-g macros, then requires typing `REVIEW` for one row or `REVIEW N` for a batch in an interactive terminal. Check the source and dish description first. A batch is limited to 50 unique rows and updates all selected rows together; it handles unpublished FDC imports and active FNDDS seed rows. Unreviewed rows remain available for manual search but are excluded from AI meal planning. After nutrition review and publication, record dietary and allergen metadata when you need those foods to qualify for saved diet filters. Use the package label or a reliable recipe/source, never infer tags from the food name alone:

```bash
npm run catalog:safety:review -- --food-id <catalog-id> --dietary-tags vegetarian --contains-allergens milk --may-contain-allergens peanuts --source-note "Checked package label on 2026-10-21"
```

Use comma-separated tags, and `none` when a list is empty. Dietary tags: `vegetarian`, `vegan`, `pescatarian`, `gluten_free`, `dairy_free`. Allergen tags: `celery`, `crustaceans`, `eggs`, `fish`, `gluten_cereals`, `lupin`, `milk`, `molluscs`, `mustard`, `peanuts`, `sesame`, `soybeans`, `sulphites`, `tree_nuts`. A tag set with an empty dietary list does not qualify for a stated diet filter. The filters are catalog guidance and do not guarantee allergy safety or prevent cross-contamination; users must check current labels and recipes. Personal foods are excluded from meal-plan search and edits whenever a recognized dietary/allergen filter applies.

Use only a matching generic Foundation, SR Legacy, or Survey food. Check the description and per-100-g calories/macros before publishing. Imports remain invisible to food search until published. Aliases are search labels only and do not change nutrition data. USDA FoodData Central data are CC0/public domain; keep attribution and the FDC ID in the catalog. The Indian Food Composition Tables have separate reuse restrictions: their official publication prohibits storing/reproducing the data electronically for a product without prior written permission. Do not bulk-import IFCT values without that permission. [USDA API and license](https://fdc.nal.usda.gov/api-guide/) · [ICMR-NIN IFCT 2017 terms](https://www.nin.res.in/ebooks/IFCT2017_16122024.pdf)

To seed a larger generic food catalog without making one API call per food, download USDA's FNDDS 2021–2023 JSON archive and extract its `surveyDownload.json` outside the repository:

```bash
curl -fL -o /tmp/healthcare-fndds.zip https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip
unzip -p /tmp/healthcare-fndds.zip surveyDownload.json > /tmp/surveyDownload.json
npm run catalog:seed:fndds -- --file /tmp/surveyDownload.json --dry-run
npm run catalog:seed:fndds -- --file /tmp/surveyDownload.json
```

The configured Neon catalog was seeded on 21 October 2026 with 5,431 generic foods and 22,118 standard portion references. The import validates the FNDDS data type, FDC IDs, and the four required macro values, skips records missing or outside the app's safety bounds, and is idempotent by source and FDC ID. It imports generic FNDDS foods for manual search/logging and imports the dataset's standard portion weights as shared defaults. The maintainer has now source-reviewed 33 foods for general AI meal plans, with 92 serving references; the remaining 5,398 stay unreviewed and excluded. Neon currently has no dietary/allergen safety reviews, so constrained meal plans fail closed. Survey serving weights are references, not a promise that a home katori, roti, or recipe has the same weight. Aliases are search labels only: keep them within the USDA description's level of detail. For example, the generic "Biryani with meat" record is not specific enough to label as mutton biryani. The importer adds search aliases and common South Indian spellings for available entries such as idli, dosa, dal, roti, sambar, upma, vadai, chutney, and biryani. FNDDS is a US dietary-survey dataset, not a complete Indian food table; dishes such as rasam and puli kuzhambu are not represented by those aliases and need separately verified entries or private recipes. Use personal foods for household recipes or items whose values differ, and extend the shared catalog only with checked, sourced entries. The archive is about 3.7 MB compressed; the extracted file is temporary, contains no user data, and should not be committed. USDA data are CC0 and should remain attributed to FoodData Central. See [USDA's download page](https://fdc.nal.usda.gov/download-datasets/).

## Phone, PWA, and APK behavior

During local development, use the computer's LAN address from the phone and set local auth origins accordingly. For everyday use by friends on other networks, deploy the app to Vercel over HTTPS. Friends can open the URL in Chrome or install the private Expo APK, which opens the same hosted app in a WebView.

The app has one public origin and no separately deployed API host. APKs include the public app URL, but no API credential. The WebView shell does not provide direct Health Connect integration or dependable background step collection. Keep steps manually editable unless a native bridge is built and verified later.

### Photo estimate review and logging

The selected provider key (`GROQ_API_KEY`, or explicitly selected Gemini configuration) powers initial photo estimates and optional follow-up refinements. Each inference counts toward the shared per-account AI quota; the UI allows at most two follow-up attempts per uploaded photo. Editing portions/macros and confirming a draft use no AI call. No storage service is required for this path.

The existing server-only `AUTH_SECRET` signs a two-hour, account-bound review token containing the validated estimate, with no photo bytes or credentials. Keep it stable. User confirmation verifies ownership/signature/expiry and the completed AI run, validates corrections, calculates totals, and writes all selected food-log entries in one transaction. Original photos and clarification text are not retained by app storage; confirmed snapshots include model/run provenance, portion range/certainty, and correction status. Photo logs are marked `photo_estimate`, separate from reviewed catalog values. No database migration is required.

### Typed-food estimates and private reuse

No extra variables or migrations are required. `POST /v1/foods/estimate-text` uses the same Gemini connection, timeout/output limits, account quota, signed drafts, and confirmation path as photos. The UI offers it only after the current All foods search returns no match; the user must explicitly submit the form. Search/typing and normal logging of saved foods never invoke Gemini.

For compatibility with the current database constraint, text and photo inference rows both use the existing `food_vision` AI-run bucket; `inputSnapshot.inputType` and prompt/schema versions distinguish them. The server retains input lengths rather than the unconfirmed food name or clarification text. Signing includes input type, and confirmation checks it against the owned completed run.

The optional My foods checkbox writes private per-100-g densities to `user_foods` in the same transaction as confirmed food logs. A server-written `AI estimate (unverified).` source-note prefix identifies cached estimates without changing the database schema. Search returns an estimate flag; normal logging preserves `nutritionProvenance: ai_estimate`. New logs use generic `foodEstimate` metadata, while existing photo metadata and signed drafts remain readable. Cached densities use the existing two-decimal database precision. This private cache does not establish reviewed recipe, dietary, or allergen facts.
