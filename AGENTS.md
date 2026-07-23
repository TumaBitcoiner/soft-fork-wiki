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
API health: http://localhost:8000/health
```

Leave the launcher running while testing. Stop both processes with `Ctrl+C`.

On the first backend launch, the application clones `bitcoin/bips` into
`data/bitcoin-bips` and indexes the selected BIPs into `data/app.sqlite`.
Do not run `git pull` or ingestion work on individual API requests.

Verify both services after launch:

```bash
curl http://localhost:8000/health
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
launcher. It requires a repo-root `config.json` with `bips_db_path` pointing at
the Phase 1 SQLite database and a valid `ppq_api_key`.

The `src/sentiment` directory is preserved but is not part of the Phase 1 local
launch. Its functionality will be integrated into the unified backend
incrementally.

## Explicit frontend mock mode

Mock data is available only when explicitly configured. Set this in
`src/frontend/.env`, then restart Vite:

```text
VITE_DATA_MODE=mock
```

Do not add mock fallbacks to HTTP mode. Test Lab remains a separate,
clearly-labelled browser simulation.

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
