# Healthcare

An Android-first health and fitness app for food logging, activity tracking, and measured progress toward a personal goal. The intended distribution is a private signed APK for the owner and invited friends.

**Current implementation: Phase 1 UI and the Phase 2 backend foundation.** The app launches into four navigable screens: Home, Food, Activity, and Progress. The screens still use sample data. The backend now has invite-gated authentication, profile/sync endpoints, database migrations, and local encrypted storage primitives; they are not wired into the screens or deployed yet. AI plans, photo recognition, Health Connect, reminders, and Calendar are later phases.

The product specification, design direction, data model, AI workflows, release approach, and phase gates are in [the implementation plan](docs/IMPLEMENTATION_PLAN.md). Phase 0 integration decisions and remaining device/account checks are in [the Phase 0 decision log](docs/decisions/0001-phase-0.md).

## Stack

- Expo SDK 57, React Native, TypeScript, and Expo Router
- Minimal black, white, gray, and lime/green design with Manrope
- Custom SVG progress chart to keep the goal path, measured trend, weigh-in points, and missing days explicit
- Neon Postgres and a Hono/TypeScript API, on-device SQLCipher SQLite, and server-side MiniMax M3 through OpenRouter
- Planned: two bounded LangGraph workflows for reviewed meal and workout plans

The Android package ID and app display name are working values. Confirm them before the first signed APK is shared.

## Run the UI preview

### Prerequisites

- Node.js 22.13 or later and npm 10 or later
- For a UI-only preview, install Expo Go. Phase 2 secure sessions and SQLCipher storage require a development build.
- For a local emulator, install Android Studio with an Android emulator and SDK

Install dependencies from the repository root:

```bash
npm install
```

Start the development server:

```bash
npm run start
```

For a phone preview, put the phone and computer on the same network, scan the QR code with Expo Go, and open the app. If local network discovery is blocked, start Expo with its tunnel option:

```bash
npm run start -- --tunnel
```

For an Android emulator, start the emulator first, then run:

```bash
npm run android
```

A browser preview is available with:

```bash
npm run web
```

The preview intentionally marks all sample values. The main call to action on Home opens the Progress screen; the other tracking controls remain visual placeholders until their implementation phases.

## Configure and run the backend

See [environment setup](docs/ENVIRONMENT.md) for every variable, where it comes from, and which phase uses it. To start the current API foundation:

1. Copy `.env.example` to `.env` in the repository root.
2. Set `DATABASE_URL`, `AUTH_SECRET`, and `AUTH_BASE_URL` there.
3. Copy `apps/mobile/.env.example` to `apps/mobile/.env` and set the phone-reachable `EXPO_PUBLIC_API_BASE_URL`.
4. Run the auth and application migrations, then start the API:

```bash
npm run db:migrate
npm run api:dev
```

Create an email-bound invitation for a friend with:

```bash
npm run invite:create -- --email friend@example.com
```

Share the one-time code privately. A physical Android phone must be able to reach the API host over the network. For EAS builds, set `EXPO_PUBLIC_API_BASE_URL` in the EAS environment used by that build; ignored local `.env` files are not committed to the cloud build. The mobile API URL is public app configuration; provider credentials stay in the backend `.env`.

## Checks

From the repository root:

```bash
npm run typecheck
npm run lint
npm run doctor
```

Expo dependencies are pinned in the workspace lockfile. When adding Expo or native packages, use the local SDK's installer from `apps/mobile`:

```bash
cd apps/mobile
npx expo install <package-name>
```

A real Android build, system font scaling review, Android Back behavior review, and Health Connect permission review still require an Android device or emulator. The current environment does not have `adb` or the Android SDK installed. `npm run doctor` currently reports the host Mac's Xcode version as its sole failed check; this app is configured for Android and web, and Android-relevant dependency/configuration checks pass. Review `npm audit` findings before sharing a build. Avoid `npm audit fix --force` unless you are prepared to make and verify the required major-version upgrades.

### Private Android APK profiles

The Expo app has internal EAS profiles for development, preview, and production. All produce installable APKs; the development profile also includes the development client. An Expo account is required for the cloud build and signing setup.

```bash
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform android
npx eas-cli@latest build --profile production --platform android
```

The first EAS build may ask to configure Android signing. Let EAS manage signing for private distribution and keep credentials outside Git. Confirm the app identity in `apps/mobile/app.json` before creating a build that will be shared. These profiles are configured only; no APK has been built yet.

## Repository setup and public-repository safeguards

This GitHub repository is public. It must contain source and documentation only, never API keys, database credentials, OAuth secrets, session tokens, signing keys, personal health data, or private meal photos.

New clones should enable the repository hooks:

```bash
sh scripts/setup-git-hooks.sh
```

The hooks reject staged files that match ignore rules, scan staged changes and local history with Gitleaks, and enforce Conventional Commit subjects under 72 characters. Install Python 3 and Gitleaks first; see [SECURITY.md](SECURITY.md). Use explicit `git add` paths and review `git diff --cached` before committing.

`.env.example` contains blank credential fields and safe defaults. Keep real values in the ignored root `.env`. `EXPO_PUBLIC_*` values are included in the APK and must be safe for anyone to read. OpenRouter, storage, Google, USDA, and SMTP settings are listed for later phases and are not needed for the current manual/API foundation.

## Roadmap

Implementation follows [the phased plan](docs/IMPLEMENTATION_PLAN.md#16-implementation-phases). Phase 1 provides the navigable visual shell and internal Android APK profiles. Phase 2 backend and local-storage foundations are scaffolded, but still need Neon credentials, migration execution, Android build verification, and integration with the app screens. Later phases add goal calculations, curated food data, manual tracking, the measured progress graph, image recognition, planning workflows, Health Connect, reminders, and private APK operations.

The first APK will be built and signed only after the required app identity, Android version matrix, cloud resources, and release safeguards are confirmed. Do not commit signing material.

## Git commit style

Use focused Conventional Commits, for example:

```text
feat(mobile): add the progress preview
fix(progress): keep missing weigh-ins as gaps
docs: update the local development guide
```

Before committing, stage the intended files and inspect them:

```bash
git status --short
git add README.md apps/mobile docs
git diff --cached --stat
git diff --cached
git commit -m "feat(mobile): add the navigable app preview"
```
