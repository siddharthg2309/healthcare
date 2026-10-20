# Environment setup

Use the root `.env.example` for backend secrets and future server integrations. Copy it to `.env` in the repository root. For local Expo runs, also copy `apps/mobile/.env.example` to `apps/mobile/.env`. Both files are ignored by Git; keep provider secrets in the root file and never put them in `EXPO_PUBLIC_*` variables.

```bash
cp .env.example .env
cp apps/mobile/.env.example apps/mobile/.env
```

## Needed for the current backend foundation

| Variable | What to put there | Where it comes from |
| --- | --- | --- |
| `DATABASE_URL` | Neon Postgres connection URL, including its SSL settings | Neon Console → project → **Connect**. Choose the pooled Node.js connection URL. This is private server configuration. |
| `AUTH_SECRET` | A new random secret, at least 32 characters | Generate locally with `openssl rand -base64 32`. Keep it private. |
| `AUTH_BASE_URL` | The backend's origin, such as `http://192.168.1.20:8787` on your home network or `https://api.example.com` after deployment | Your computer's LAN address for local Android development, or your deployed API URL. |

Set `EXPO_PUBLIC_API_BASE_URL` in `apps/mobile/.env` to the same API origin. This value is public and compiled into the APK. On a physical phone, `localhost` points to the phone, so use your computer's LAN IP while developing.

`NODE_ENV=development` and `PORT=8787` are safe defaults. `AUTH_TRUSTED_ORIGINS` can stay blank for the current app scheme and local development setup. Set it only when adding another exact web origin.

After filling these four variables, run migrations and start the API:

```bash
npm run db:migrate
npm run api:dev
```

Create an email-bound friend invitation from another terminal:

```bash
npm run invite:create -- --email friend@example.com
```

The command prints a one-time invite code. Share it privately. Signup requires both that code and the invited email address.

## Add when enabling later features

| Feature | Variables | Setup |
| --- | --- | --- |
| Meal/activity AI and food-photo recognition | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE`, `AI_MODEL`, `AI_MONTHLY_BUDGET_USD`, `AI_MAX_OUTPUT_TOKENS`, `AI_MAX_PHOTO_BYTES` | Create a key in OpenRouter. The selected model defaults to `minimax/minimax-m3`. Keep the key on the backend. Budget and size values are server limits, not credentials. |
| Background jobs | `JOB_DISPATCH_SECRET` | Generate with `openssl rand -hex 32`. Use the same value only in the backend and its private worker. |
| Food-photo object storage | `STORAGE_PROVIDER`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_FORCE_PATH_STYLE`, `UPLOAD_MAX_BYTES` | Choose a private S3-compatible bucket first. Keep its access key and secret on the backend. Do not use a public bucket for meal photos. |
| Google Calendar token storage | `TOKEN_ENCRYPTION_KEY` | Generate with `openssl rand -hex 32`. Keep the value stable and private so existing refresh tokens remain readable. |
| Google Calendar OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Create OAuth credentials in Google Cloud Console when Calendar integration is implemented. The client secret is server-only. |
| Food catalog imports | `USDA_API_KEY` | Obtain a FoodData Central API key only if catalog imports use that source. Manual catalog editing does not need one. |
| Email verification or password reset | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` | Fill these only after choosing an email service and enabling email flows. The SMTP password is server-only. |

## Local Android networking

The computer and Android phone must be able to reach one another. During local development, set `AUTH_BASE_URL` in root `.env` and `EXPO_PUBLIC_API_BASE_URL` in `apps/mobile/.env` to the computer's LAN IP and port, for example `http://192.168.1.20:8787`. Expo reads app environment files from the mobile project directory. Allow that port through the computer's firewall. For an EAS build, set `EXPO_PUBLIC_API_BASE_URL` in the EAS environment used by that build. For a friend using the app from another network, deploy the backend to an HTTPS address and build the APK with that address.

The `EXPO_PUBLIC_` prefix means the value is visible in the APK. Only the API address belongs there; database URLs, auth secrets, OpenRouter keys, storage credentials, and OAuth secrets do not.
