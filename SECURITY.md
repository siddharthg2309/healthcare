# Credentials and private data

This source repository is public. Keep API keys, database credentials, environment values, OAuth refresh tokens, Android signing keys, health records, uploaded photos, and backups outside tracked files.

Use ignored local environment files for development and the deployment provider's secret manager for deployed services. Commit only blank configuration examples and synthetic, clearly labeled fixtures. Review source-data licenses before publishing catalog data.

Run `sh scripts/setup-git-hooks.sh` after cloning to enable local filename checks, credential scans, and commit-message checks. Hooks are local safeguards, not proof that a change contains no sensitive data.

If a real credential is exposed, revoke or rotate it first. Stop publication of affected changes and inspect the relevant history without copying the credential into reports. Removing a file from the latest commit alone does not remove it from older commits.

Report vulnerabilities or accidental exposure to the repository owner privately. Do not post real credentials, health information, or database exports in public issues or pull requests.
