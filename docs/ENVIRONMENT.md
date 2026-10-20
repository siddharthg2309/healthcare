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
| Google Calendar OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY` | Set up only when Calendar sync is implemented. The client secret and encryption key stay on the server. |
| Curated catalog imports | `USDA_API_KEY` | Optional; put it in the ignored local `.env` only when running the one-time catalog import. It is not needed by the deployed app and should not be added to Vercel. |
| Email verification/password recovery | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` | Add after choosing an email provider and implementing those email flows. |

The LangGraph checkpoint store uses `DATABASE_URL`; it does not need a separate database URL. Leave unused integration values empty. Per-user AI quotas and daily cost limits are not implemented yet. The meal-plan screen currently supports review, portion edits, approval, rejection, and history; it does not support food swaps yet. Generation pauses when a profile has diet preferences or restrictions because the catalog does not yet store reviewed diet/allergen tags. Do not use generated plans for a restricted diet until that catalog support is completed.

### Curating shared catalog foods

The app does not call a nutrition provider whenever someone logs a meal. A maintainer can search FoodData Central, import a generic entry as an unpublished draft, review its values, then publish it to the shared catalog:

```bash
npm run catalog:search -- --query "cooked lentils"
npm run catalog:import -- --fdc-id <id-from-search> --category ingredient
npm run catalog:publish -- --food-id <catalog-id-printed-by-import>
```

Use only a matching generic Foundation, SR Legacy, or Survey food. Check the description and per-100-g calories/macros before publishing. Imports remain invisible to food search until published. USDA FoodData Central data are CC0/public domain; keep attribution and the FDC ID in the catalog. The Indian Food Composition Tables have separate reuse restrictions: their official publication prohibits storing/reproducing the data electronically for a product without prior written permission. Do not bulk-import IFCT values without that permission. [USDA API and license](https://fdc.nal.usda.gov/api-guide/) · [ICMR-NIN IFCT 2017 terms](https://www.nin.res.in/ebooks/IFCT2017_16122024.pdf)

## Phone and PWA behavior

During local development, use the computer's LAN address from the phone and set local auth origins accordingly. For everyday use by friends on other networks, use the deployed HTTPS Vercel URL. Opening that URL works in Android Chrome; users can choose **Add to Home screen** to launch it like an app.

This PWA has one public origin, so no `EXPO_PUBLIC_API_BASE_URL`, separate backend URL, native app identifier, or APK build is needed. Browser/PWA access does not provide direct Health Connect integration or dependable background step collection. Keep steps manually editable unless a separate native Android companion is built later.
