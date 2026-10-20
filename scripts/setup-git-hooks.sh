#!/bin/sh
set -eu

command -v git >/dev/null 2>&1 || {
  printf '%s\n' 'Git is required.' >&2
  exit 1
}
command -v python3 >/dev/null 2>&1 || {
  printf '%s\n' 'Python 3 is required.' >&2
  exit 1
}
command -v gitleaks >/dev/null 2>&1 || {
  printf '%s\n' 'Install Gitleaks first: brew install gitleaks' >&2
  exit 1
}

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
current_hooks=$(git config --get core.hooksPath || true)
if [ -n "$current_hooks" ] && [ "$current_hooks" != '.githooks' ]; then
  printf '%s\n' 'A custom Git hooks path is already configured. Integrate the checks without replacing it.' >&2
  exit 1
fi

chmod +x .githooks/pre-commit .githooks/commit-msg .githooks/pre-push
git config --local core.hooksPath .githooks
printf '%s\n' 'Repository hooks enabled: filename checks, Gitleaks, and Conventional Commit subjects.'
