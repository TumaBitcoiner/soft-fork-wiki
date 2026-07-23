#!/usr/bin/env bash
set -euo pipefail

backend_pid=""
llm_pid=""

cleanup() {
  if [[ -n "${backend_pid}" ]]; then
    kill "${backend_pid}" 2>/dev/null || true
  fi
  if [[ -n "${llm_pid}" ]]; then
    kill "${llm_pid}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

uvicorn app.main:app --app-dir src/backend --reload --port 8000 &
backend_pid=$!

uvicorn app.main:app --app-dir src/llm-backend --reload --port 8001 &
llm_pid=$!

wait
