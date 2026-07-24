# Local project development instructions

Run all commands from the repository root unless a section says otherwise.
Keep the frontend in `src/frontend` and the unified FastAPI backend in
`src/backend`.

## First-time setup

Install the backend and frontend dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r src/backend/requirements-dev.txt
npm --prefix src/frontend install
corepack pnpm@9.0.0 --dir src/sentiment install
```

Create the local environment files:

```bash
cp .env.example .env
cp src/frontend/.env.example src/frontend/.env
```

The default frontend configuration must use the local backend:

```text
VITE_DATA_MODE=http
VITE_API_BASE_URL=http://localhost:8000
VITE_SENTIMENT_BASE_URL=http://localhost:8002
```

Do not commit `.env`, SQLite databases, the cloned BIP repository,
`node_modules`, or `.venv`.

## Launch the complete project

Start the unified backend and frontend together:

```bash
npm run dev
```

The root launcher starts:

```text
Frontend:   http://localhost:5173
Backend:    http://localhost:8000
LLM:        http://localhost:8001
Sentiment:  http://localhost:8002
API health: http://localhost:8000/health
```

Leave the launcher running while testing. Stop all four processes with `Ctrl+C`.

On the first backend launch, the application clones `bitcoin/bips` into
`data/bitcoin-bips` and indexes the selected BIPs into `data/app.sqlite`.
Do not run `git pull` or ingestion work on individual API requests.

Verify both services after launch:

```bash
curl http://localhost:8000/health
curl http://localhost:8002/health
curl -I http://localhost:5173
```

## Launch services separately

Backend:

```bash
source .venv/bin/activate
uvicorn app.main:app --app-dir src/backend --reload --port 8000
```

Frontend, in a second terminal:

```bash
npm --prefix src/frontend run dev
```

The `src/llm-backend` service now runs alongside the main backend in the local
launcher. It requires a repo-root `config.json` with `bips_repo_path` pointing
at the local `bitcoin/bips` checkout, `bips_db_path` pointing at the Phase 1
SQLite database, and `ppq_api_key` set for generation. Without a key the base
BIP and source tabs still work, but first-view Overview generation returns a
clear configuration error. Overview output is cached separately in
`explain_db_path`.

The sentiment service runs separately on port 8002. Its captured snapshot makes
BIPs 54, 110, 118, 119, 141, 158, 300, 340, 341, 347, 352, 360, and 444
available immediately without an LLM key. Other BIPs perform a cold Nostr read
and classification that may take 30–90 seconds. Put `GEMINI_API_KEY` in the
repo-root `.env` for those requests; the launcher passes it only to server-side
processes and the frontend never receives it.

To run sentiment separately:

```bash
set -a; source .env; set +a
corepack pnpm@9.0.0 --dir src/sentiment --filter @soft-fork-wiki/service dev
```

## Explicit frontend mock mode

Mock data is available only when explicitly configured. Set this in
`src/frontend/.env`, then restart Vite:

```text
VITE_DATA_MODE=mock
```

Do not add mock fallbacks to HTTP mode.

## Validate changes

Run the complete validation suite:

```bash
npm test
```

For frontend-only validation:

```bash
npm --prefix src/frontend test
```

For backend-only validation:

```bash
.venv/bin/pytest src/backend/tests
```

The full validation performs backend tests, TypeScript checking, ESLint,
frontend unit tests, and a production build. Work is not complete until the
relevant validation passes.

See `LOCAL_DEVELOPMENT.md` for environment variables, API endpoints, manual
verification, and troubleshooting details.
