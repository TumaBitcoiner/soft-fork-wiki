#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -x "${repo_root}/.venv/bin/pytest" ]]; then
  echo "Backend test dependencies are missing. Follow LOCAL_DEVELOPMENT.md setup first." >&2
  exit 1
fi

cd "${repo_root}"
"${repo_root}/.venv/bin/pytest" src/backend/tests
"${repo_root}/.venv/bin/pytest" src/llm-backend/tests
corepack pnpm@9.0.0 --dir src/sentiment -r typecheck
corepack pnpm@9.0.0 --dir src/sentiment --filter @soft-fork-wiki/service test
npm --prefix src/frontend test
