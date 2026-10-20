# Decision 0005: Private Android APK around the hosted app

**Status:** Accepted.

## Context

The owner wants a directly installable Android APK for a small invited group, with no Play Store release. The existing Next.js PWA and same-origin API already contain the product screens and business logic. Duplicating these features in a separate native client would add a second UI implementation and delay the usable app.

## Decision

- Keep the Next.js PWA as the product UI and host its pages and API on Vercel.
- Build `apps/mobile` as a thin Expo Android shell using `react-native-webview` to load the stable production HTTPS app URL.
- Use Neon as the cloud database. The APK contains only public URL configuration; all database, auth, OpenRouter, storage, and OAuth secrets remain in server environments.
- Build an APK with EAS internal distribution and share the build privately. Do not publish it to Google Play.
- Keep the browser PWA available as an optional install path and fallback.
- A Vercel redeployment updates the web UI inside installed APKs. Changes to the native shell, app icon, package ID, or native permissions require a new APK.
- The WebView shell alone does not provide Health Connect access, reliable background step collection, or native scheduled notifications. Add native bridges only as separate, verified work.

## Consequences

Using the APK requires both a stable Vercel deployment and an EAS cloud build. Friends install an APK instead of enabling PWA home-screen installation. The app continues to require internet access for cloud data and hosted features.

The EAS build needs an Expo account and a one-time EAS project link/signing setup. EAS signing credentials must remain managed outside Git. The production app URL is compiled into the shell as public configuration; changing the URL requires a new shell build.
