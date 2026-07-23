#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_pid=""
frontend_pid=""

cleanup() {
  if [[ -n "${backend_pid}" ]]; then
    kill "${backend_pid}" 2>/dev/null || true
  fi
  if [[ -n "${frontend_pid}" ]]; then
    kill "${frontend_pid}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

if [[ ! -x "${repo_root}/.venv/bin/uvicorn" ]]; then
  echo "Backend dependencies are missing. Follow LOCAL_DEVELOPMENT.md setup first." >&2
  exit 1
fi

if [[ ! -d "${repo_root}/src/frontend/node_modules" ]]; then
  echo "Frontend dependencies are missing. Run: npm --prefix src/frontend install" >&2
  exit 1
fi

cd "${repo_root}"
"${repo_root}/.venv/bin/uvicorn" app.main:app \
  --app-dir src/backend \
  --reload \
  --port 8000 &
backend_pid=$!

npm --prefix src/frontend run dev &
frontend_pid=$!

wait
