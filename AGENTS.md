# Project instructions

## Scope and agreed direction

- This is an Android-first health and fitness app with account creation through any verified Google account; email/password sign-up remains invitation-based. The Next.js PWA is the product UI and the private Android APK is a thin Expo WebView shell around it.
- The source of the product and phased implementation scope is `docs/IMPLEMENTATION_PLAN.md`.
- Use Next.js App Router, React, and TypeScript; deploy the UI and same-origin API on Vercel, with Neon Postgres for cloud storage.
- Deploy the Next.js app and API to Vercel with Neon Postgres. Build the Android shell as an internally distributed APK with EAS; do not publish to an app store.
- Keep the APK shell thin: it loads the deployed PWA from a configured HTTPS URL. Do not duplicate feature screens in React Native unless the user asks for native functionality.
- Keep two bounded LangGraph workflows for meal/workout planning. Food photo recognition is a separate operation.
- Derive calories, macros, summaries, and graph values from validated records and application code.
- Follow the minimal black/white/gray/lime design. Actual progress versus the accepted goal path is a core feature.
- The WebView APK does not by itself provide Health Connect access or reliable background step collection; support manual activity logging unless a native bridge is implemented and approved.
- Use this repository's checkout for implementation and preserve unrelated user work.

## Public repository and credentials

- Treat every tracked file and commit message as public.
- Never commit credentials, real environment values, personal health records, food photos, database copies, OAuth tokens, or signing keys.
- Keep `.env.example` blank for secrets. Update it when configuration changes.
- Keep confidential values on the backend; `NEXT_PUBLIC_*` values must be safe for anyone to read.
- Check ignore rules and staged paths before committing. Do not force-add ignored files.
- Use this repository's Git hooks and Gitleaks. Resolve findings without bypassing checks or adding broad suppressions.
- If a secret is found in existing history, report it without reproducing its value; revoke/rotate it before any planned publication.

## Commits and documentation

- Use focused Conventional Commits: `type(scope): imperative description` or `type: imperative description`.
- Keep subjects at most 72 characters and explain the actual change.
- Review the exact staged files; avoid sweeping unrelated changes into a commit.
- Keep README setup/run/deploy instructions accurate as runnable components are added.
- Document new environment variables with blank examples and their public/server-only scope.
- Update the implementation plan when an agreed architectural decision changes.
- Distinguish planned functionality from implemented functionality.

## Implementation quality

- Validate inputs, ownership, units, and source provenance at the backend.
- Preserve immutable nutrition/goal versions and safe online retry semantics.
- Revalidate edited/stale AI plans before approval; do not activate unapproved drafts.
- Keep private user data isolated by authenticated account.
- Run meaningful checks appropriate to the change and record limitations honestly.
