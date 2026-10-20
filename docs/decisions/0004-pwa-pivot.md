# Decision 0004: Next.js PWA and Vercel deployment

**Status:** Accepted. This is the current platform and deployment decision.

## Context

The app is for the owner and a small group of invited friends using Android phones. The owner prefers a simple web deployment and home-screen shortcut over building, signing, sharing, and updating an APK.

## Decision

- Build the primary client as a responsive Next.js App Router PWA.
- Deploy the Next.js project to Vercel. Pages and server-side API routes share one HTTPS origin.
- Keep Neon Postgres as the hosted database and source of truth.
- Mount the existing modular Hono API behind Next.js Route Handlers. Do not deploy a separate API host for the manual-tracking MVP.
- Use Better Auth with server-side `DATABASE_URL`, `AUTH_SECRET`, `AUTH_BASE_URL`, and exact trusted origins.
- Keep OpenRouter and all future provider credentials in server-only environment variables. Add the OpenRouter key when server-side AI features are implemented.
- Users open the Vercel URL in Android Chrome and may choose Add to Home screen. Vercel deploys future source updates; user data remains in Neon.
- Keep the MVP online-first. The service worker may cache static assets/offline help, not private health API responses or unsent logs.
- Support manual steps/activity. Direct Health Connect access and dependable background step collection are deferred to a possible native Android companion.
- Treat browser notifications as optional and permission-dependent. Provide in-app reminder states; Calendar remains an optional web OAuth integration.
- Meal and workout plans remain bounded LangGraph workflows with persisted state, deterministic checks, and user approval. Food-photo identification remains a separate vision request.

## Consequences

The owner does not need an APK, Play Store listing, Expo/EAS setup, or a laptop-hosted production backend. Friends need only the shared HTTPS URL and invitation code. The deployed Vercel project and Neon database must remain available for cloud use.

The PWA has fewer Android capabilities than a native app. Features that require Health Connect, reliable all-day sensors, or dependable local background alarms need a separate native implementation. A durable workflow worker may be added later only if measured AI run times exceed the chosen Vercel request limits.

Decision logs 0001–0003 record the earlier Expo/APK direction and are retained as history. This decision supersedes their platform, backend deployment, offline-storage, and distribution choices. Their domain, security, and data-model decisions remain applicable where consistent with this PWA architecture.
