# Local development

Phase 1 runs the React frontend and two FastAPI backends locally:

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:8000>
- LLM backend: <http://localhost:8001>
- API health: <http://localhost:8000/health>

SQLite is used by default. On the first backend start, the backend clones
`bitcoin/bips` into `data/bitcoin-bips` and incrementally indexes consensus
soft-fork BIPs into `data/app.sqlite`.

## First-time setup

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r src/backend/requirements-dev.txt
npm --prefix src/frontend install
cp .env.example .env
cp src/frontend/.env.example src/frontend/.env
```

The example values work for the default local setup. Do not commit either
`.env` file.

## Start both services

```bash
npm run dev
```

The launcher stops all child processes when you press `Ctrl+C`.

## Start services separately

Backend:

```bash
source .venv/bin/activate
uvicorn app.main:app --app-dir src/backend --reload --port 8000
```

Frontend:

```bash
npm --prefix src/frontend run dev
```

LLM backend:

```bash
uvicorn app.main:app --app-dir src/llm-backend --reload --port 8001
```

## Environment variables

Backend variables:

- `BIPS_REPO_PATH` — local `bitcoin/bips` checkout; defaults to
  `./data/bitcoin-bips`.
- `DATABASE_URL` — Phase 1 supports SQLite URLs; defaults to
  `sqlite:///./data/app.sqlite`.
- `ADMIN_TOKEN` — protects the manual refresh endpoint.
- `CORS_ORIGINS` — comma-separated frontend origins.
- `LLM_BASE_URL` — base URL for the LLM backend; defaults to
  `http://localhost:8001`.
- `PPQ_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` — reserved for Phase 2.
- `NOSTR_RELAYS` — reserved for Phase 3 server-side reads.

Frontend variables:

- `VITE_DATA_MODE=http` — use the local API. Mock mode is available only with
  the explicit value `mock`.
- `VITE_API_BASE_URL=http://localhost:8000`

## API

Implemented in Phase 1:

```text
GET  /health
GET  /api/bips
GET  /api/bips/meta
GET  /api/bips/{bip_number}
GET  /api/bips/{bip_number}/meta
POST /api/admin/refresh-bips
POST /api/explain
POST /api/ask
POST /ask
GET  /last-answer/{bip_number}
```

Refresh the local BIP checkout and re-index changed records:

```bash
curl -X POST \
  -H "X-Admin-Token: change-me" \
  http://localhost:8000/api/admin/refresh-bips
```

The backend never pulls on a read request.

Not implemented yet:

- Ask Anything (Phase 2/5)
- `/api/sentiment/{bip_number}` (Phase 3)
- Nostr publishing helpers (Phase 4)

HTTP mode returns an explicit unavailable error for these features. Test Lab
continues to use a separate, clearly labelled browser simulation.

## LLM backend

The LLM backend runs on port 8001 and is started by `npm run dev`.
It requires a repo-root `config.json` with `bips_db_path` pointing at the Phase 1
SQLite database and a valid `ppq_api_key`.

## Tests

Run the full local validation:

```bash
npm test
```

Or run each side independently:

```bash
.venv/bin/pytest src/backend/tests
npm --prefix src/frontend test
```

## Manual Phase 1 checklist

- Open `/health` and confirm `status` is `ok` with a non-zero `bipCount`.
- Open the frontend and confirm the BIP explorer shows backend records.
- Open an individual BIP and confirm its metadata and source tab load.
- Stop the backend and confirm the frontend shows an error rather than mock BIPs.
- Set `VITE_DATA_MODE=mock`, restart the frontend, and confirm mock mode is
  available only when explicitly selected.
- Confirm the existing Nostr login/signer flow still opens.
- Open Test Lab and confirm every result is labelled as simulated.
- Request a missing BIP and confirm the backend returns HTTP 404.

## Rollback

Phase 1 does not move or delete any existing service. To roll back, revert the
Phase 1 commit. Local files under `data/`, `.venv/`, and `.env` are ignored and
may be removed separately without affecting source history.
