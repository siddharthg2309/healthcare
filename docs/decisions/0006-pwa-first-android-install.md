# Decision 0006: PWA-first Android installation

**Status:** Accepted.

## Context

The product UI and API already run as a Next.js PWA hosted on Vercel. Android Chrome can install this app from its HTTPS URL, which avoids a separate native build and makes routine web updates available through Vercel deployments. A thin Expo WebView APK remains useful for people who prefer a directly shared package, but it does not add Health Connect or dependable background services.

## Decision

- Make the Vercel-hosted PWA installed from Android Chrome the default and simplest phone experience.
- Keep the Expo WebView APK as an optional private distribution path; do not require an APK build for ordinary use or web releases.
- Keep both install paths on the same HTTPS origin, UI, API, accounts, and Neon data.
- Use Vercel for the web UI and API; the user's laptop is only needed for development and reviewed database migrations.
- Keep native capabilities out of the APK unless a separate native bridge is implemented and verified.

## Consequences

The first deployment still requires the Vercel project, server environment variables, and a one-time Neon schema migration. Afterward, web changes deploy from the connected Git branch and are available to PWA users without rebuilding. Building or changing the optional APK still requires Expo/EAS setup; shell changes require a new APK.
