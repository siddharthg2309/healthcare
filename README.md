# Healthcare

An Android-first health and fitness app for food logging, activity tracking, and measured progress toward a personal goal. The intended distribution is a private signed APK for the owner and invited friends.

**Current implementation: Phase 1 UI preview and Android build profiles.** The app launches into four navigable screens: Home, Food, Activity, and Progress. The values are sample data. Food logging, local storage, sign-in, syncing, AI plans, Health Connect, reminders, and Calendar are not wired up yet.

The product specification, design direction, data model, AI workflows, release approach, and phase gates are in [the implementation plan](docs/IMPLEMENTATION_PLAN.md). Phase 0 integration decisions and remaining device/account checks are in [the Phase 0 decision log](docs/decisions/0001-phase-0.md).

## Stack

- Expo SDK 57, React Native, TypeScript, and Expo Router
- Minimal black, white, gray, and lime/green design with Manrope
- Custom SVG progress chart to keep the goal path, measured trend, weigh-in points, and missing days explicit
- Planned: Neon Postgres and server API, on-device SQLite, and server-side MiniMax M3 through OpenRouter
- Planned: two bounded LangGraph workflows for reviewed meal and workout plans

The Android package ID and app display name are working values. Confirm them before the first signed APK is shared.

## Run the UI preview

### Prerequisites

- Node.js 22.13 or later and npm 10 or later
- For a physical Android phone, install Expo Go while the project remains on the Expo Go-compatible SDK template
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

A real Android build, system font scaling review, Android Back behavior review, and Health Connect permission review still require an Android device or emulator. The current environment does not have `adb` or the Android SDK installed. `npm run doctor` currently reports the host Mac's Xcode version as its sole failed check; this app is configured for Android and web, and Android-relevant dependency/configuration checks pass. `npm audit` reports 29 upstream Expo/React Native toolchain advisories (11 moderate and 18 high). npm only offers incompatible major-version downgrades for the full set, so do not force that change; recheck for compatible upstream patches before a shared release.

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

No `.env` file is needed for the Phase 1 preview. When server configuration is added, document it in blank examples and keep private values on the backend. `EXPO_PUBLIC_*` values are included in the APK and must be safe for anyone to read.

## Roadmap

Implementation follows [the phased plan](docs/IMPLEMENTATION_PLAN.md#16-implementation-phases). Phase 1 currently provides the navigable visual shell and internal Android APK profiles. Later phases add authentication and offline sync, goal calculations, curated food data, manual tracking, the measured progress graph, image recognition, planning workflows, Health Connect, reminders, and private APK operations.

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
