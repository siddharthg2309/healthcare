# Healthcare

An Android app for food and workout tracking, reviewed meal/workout plans, and a clear view of progress against a personal goal and timeline. The intended audience is the owner and invited friends using a signed APK.

**Current status: planning and repository setup.** Application source, package manifests, cloud resources, and an APK have not been created yet. The commands below set up this repository and its Git safeguards; they do not launch an app.

The complete product specification, design system, database design, diagrams, implementation phases, and APK runbook are in [the implementation plan](docs/IMPLEMENTATION_PLAN.md).

## Product and architecture

- Food catalog focused on foods the group actually eats, including Indian dishes, household portions, snacks, and custom recipes.
- Manual and photo-assisted food logging, with user-confirmed quantities and catalog-derived calories/macros.
- Goal graphs that distinguish the accepted plan, recorded measurements, actual trend, and an optional forecast.
- Manual activity/workout logging and reviewed meal/workout plans.
- Optional Health Connect, local reminders, and Google Calendar synchronization.
- Offline records with safe synchronization when connectivity returns.
- Clean white, black, gray, and lime/green interface.

The planned stack is Expo/React Native with TypeScript, SQLite on the phone, Neon Postgres and backend services, and MiniMax M3 through OpenRouter. Two bounded LangGraph workflows handle meal and workout planning. Numeric nutrition and graph calculations belong to application code.

## Repository setup

### 1. Prerequisites

Install Git, Python 3, and [Gitleaks](https://github.com/gitleaks/gitleaks). The repository hooks use Python 3 to check filenames and commit messages, and Gitleaks to scan for credentials. On macOS with Homebrew:

```bash
brew install gitleaks
git --version
python3 --version
gitleaks version
```

When the app is scaffolded, install the selected compatible Node.js/Expo toolchain. Android Studio and its Android SDK will be needed for local native builds; EAS can also build APKs in the cloud. Concrete dependency-install, app-start, and build commands will be added when their package scripts exist.

### 2. Clone and enable the safeguards

```bash
git clone https://github.com/siddharthg2309/healthcare.git healthcareapp
cd healthcareapp
sh scripts/setup-git-hooks.sh
```

For an existing checkout, run the last command from its root. It configures `core.hooksPath` for this repository only. New clones must enable the hooks themselves; Git does not activate versioned hooks automatically.

The setup script stops if an existing custom hooks path would be replaced. Integrate those hooks deliberately instead of discarding existing checks.

### 3. Prepare local configuration when needed

```bash
cp .env.example .env
git check-ignore .env
```

The example contains blank values and a public model identifier. It documents proposed configuration; no application currently loads it. Add real values only when implementing the corresponding service. Use scoped backend/mobile environment examples once those applications exist.

Database URLs, API keys, OAuth client secrets, encryption keys, storage signing credentials, and job-dispatch secrets are server-only. `EXPO_PUBLIC_*` values are readable in an APK and must never contain secrets. Google Calendar credentials, Android signing keys, and health data must not be committed.

### 4. Review the implementation order

Read [the phased roadmap](docs/IMPLEMENTATION_PLAN.md#16-implementation-phases). Development starts with feasibility checks and an app foundation, then identity/sync, goals, food tracking, and the main progress graph. AI workflows and external integrations follow the manual tracking MVP.

## Git safeguards and commit conventions

The public repository includes these protections:

| Protection | Behavior |
| --- | --- |
| `.gitignore` | Excludes local environment files, credential files, signing keys, build artifacts, private data, uploads, and database copies |
| `pre-commit` hook | Rejects staged files covered by ignore rules and scans staged changes with Gitleaks |
| `commit-msg` hook | Requires a clear Conventional Commit subject no longer than 72 characters |
| `pre-push` hook | Checks tracked ignored files and scans local Git history before a normal push |
| `AGENTS.md` | Records the project decisions and repository rules for coding agents |

Hooks fail if their required tools are missing. Install the tools and rerun setup rather than bypassing checks. These checks reduce risk; they do not replace reviewing the exact staged changes. `.gitignore` also does not remove an already tracked credential from history.

Use focused commits with imperative subjects, for example:

```text
docs: add the application implementation plan
chore: configure repository safeguards
feat(food): add manual meal logging
fix(progress): preserve gaps between missing measurements
```

Before committing, stage explicit paths and review them:

```bash
git status --short
git add README.md docs/IMPLEMENTATION_PLAN.md
git diff --cached --stat
git diff --cached
git commit -m "docs: update the implementation plan"
```

The filename check and history scan can also run explicitly:

```bash
python3 scripts/check-tracked-files.py
gitleaks git --redact --no-banner
```

For local, uncommitted changes, the pre-commit hook scans the staged diff. The history scan becomes useful after the first commit exists. Keep scanners and their reports local; reports may contain sensitive locations even when values are redacted.

Never force-add ignored credentials, turn a detection into a broad allowlist, or place secrets in commit messages. If a real credential is exposed, rotate/revoke it first and address history separately; deleting the latest file is insufficient. See [security guidance](SECURITY.md).

## Repository contents

```text
.env.example                   Blank planned configuration reference
.gitignore                     Secret, data, cache, and artifact exclusions
.githooks/                     Commit, message, and push checks
AGENTS.md                      Project instructions for coding agents
README.md                      Current setup guide and project overview
SECURITY.md                    Credential and private-data handling
docs/IMPLEMENTATION_PLAN.md     Full plan with architecture and workflows
scripts/setup-git-hooks.sh      Enable this checkout's safeguards
scripts/check-tracked-files.py  Reject tracked files matching ignore rules
```

The planned application layout is `apps/mobile`, `apps/backend`, and shared `packages` for contracts, domain logic, database code, UI, and planning. Those directories will be introduced with working code in their implementation phases.

## APK distribution

The intended release is a signed standalone Android APK. Friends will install it directly, create invited accounts, and use the deployed backend for synchronization and AI. A production APK does not depend on the developer's laptop or Metro.

The plan includes [build profiles, signing, installation, updates, and operations](docs/IMPLEMENTATION_PLAN.md#17-deployment-and-apk-runbook). No APK has been produced yet. Keep the production package ID and signing key stable across updates; keep signing material outside Git.

## Maintaining the setup guide

Update this README in the same change that introduces package scripts, environment variables, migrations, native dependencies, deployment requirements, or build commands. Instructions must describe commands that actually exist and distinguish public app configuration from server-only secrets.
