# Project instructions

## Scope and agreed direction

- This is an Android health/fitness app for the owner and invited friends.
- The source of the product and phased implementation scope is `docs/IMPLEMENTATION_PLAN.md`.
- Use Expo/React Native and TypeScript, Neon Postgres, local SQLite, and the chosen MiniMax M3 route `minimax/minimax-m3`.
- Keep two bounded LangGraph workflows for meal/workout planning. Food photo recognition is a separate operation.
- Derive calories, macros, summaries, and graph values from validated records and application code.
- Follow the minimal black/white/gray/lime design. Actual progress versus the accepted goal path is a core feature.
- Use this repository's checkout for implementation and preserve unrelated user work.

## Public repository and credentials

- Treat every tracked file and commit message as public.
- Never commit credentials, real environment values, personal health records, food photos, database copies, OAuth tokens, or signing keys.
- Keep `.env.example` blank for secrets. Update it when configuration changes.
- Keep confidential values on the backend; `EXPO_PUBLIC_*` values must be safe for anyone to read.
- Check ignore rules and staged paths before committing. Do not force-add ignored files.
- Do not print credentials while inspecting configuration or include them in diffs, logs, issues, or documentation.
- Use the repository's Git hooks and Gitleaks. Resolve findings without bypassing checks or adding broad suppressions.
- If a secret is found in existing history, report it without reproducing its value; revoke/rotate it before any planned publication.

## Commits and documentation

- Use focused Conventional Commits: `type(scope): imperative description` or `type: imperative description`.
- Keep subjects at most 72 characters and explain the actual change.
- Review the exact staged files; avoid sweeping unrelated changes into a commit.
- Keep README setup/run/build instructions accurate as runnable components are added.
- Document new environment variables with blank examples and their public/server-only scope.
- Update the implementation plan when an agreed architectural decision changes.
- Distinguish planned functionality from implemented functionality.

## Implementation quality

- Validate inputs, ownership, units, and source provenance at the backend.
- Preserve immutable nutrition/goal versions and safe offline retry semantics.
- Revalidate edited/stale AI plans before approval; do not activate unapproved drafts.
- Keep private user data isolated, including SQLite data and background work after account switches.
- Run meaningful checks appropriate to the change and record limitations honestly.
