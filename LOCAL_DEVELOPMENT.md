# Local development

Local development runs the React frontend, two FastAPI backends, and the
sentiment service:

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:8000>
- LLM backend: <http://localhost:8001>
- Sentiment service: <http://localhost:8002>
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
corepack pnpm@9.0.0 --dir src/sentiment install
cp .env.example .env
cp src/frontend/.env.example src/frontend/.env
```

The example values work for the default local setup. Do not commit either
`.env` file.

## Start the complete project

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

Sentiment service:

```bash
set -a; source .env; set +a
corepack pnpm@9.0.0 --dir src/sentiment --filter @soft-fork-wiki/service dev
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
- `PPQ_API_KEY`, `ANTHROPIC_API_KEY` — server-side model credentials.
- `NOSTR_RELAYS` — reserved for Phase 3 server-side reads.
- `GEMINI_API_KEY` — used server-side for uncached sentiment classification.
- `SENTIMENT_PROVIDER` — optional sentiment provider override; use `gemini` for
  `GEMINI_API_KEY`.
- `SENTIMENT_TTL_MS` — LLM sentiment cache duration in milliseconds.
- `SENTIMENT_SNAPSHOT_FIRST` — defaults to `1`; set to `0` to force live
  classification instead of using captured readings.

Frontend variables:

- `VITE_DATA_MODE=http` — use the local API. Mock mode is available only with
  the explicit value `mock`.
- `VITE_API_BASE_URL=http://localhost:8000`
- `VITE_SENTIMENT_BASE_URL=http://localhost:8002`

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

The sentiment HTTP surface is a separate service:

```text
GET /health
GET /sentiment/{bip_number}?mode=llm
```

Captured readings are bundled for BIPs 54, 110, 118, 119, 141, 158, 300, 340,
341, 347, 352, 360, and 444. They load immediately without an API key.
Other BIPs perform a cold Nostr discovery and LLM-classification pass, which can
take 30–90 seconds and requires the selected provider's server-side API key.
The demo zap-vote UI does not contact a wallet, sign an event, publish to Nostr,
or change the returned sentiment reading.

## LLM backend

The LLM backend runs on port 8001 and is started by `npm run dev`.
It requires a repo-root `config.json` with `bips_repo_path` pointing at the
local `bitcoin/bips` checkout, `bips_db_path` pointing at the Phase 1 SQLite
database, and a valid `ppq_api_key`. Copy `config.json.example` as a starting
point. The Overview flow uses only that local BIP checkout, generates on the
first Overview visit, and caches results in `explain_db_path`.

## Tests

Run the full local validation:

```bash
npm test
```

Or run each side independently:

```bash
.venv/bin/pytest src/backend/tests
.venv/bin/pytest src/llm-backend/tests
npm --prefix src/frontend test
corepack pnpm@9.0.0 --dir src/sentiment -r typecheck
corepack pnpm@9.0.0 --dir src/sentiment --filter @soft-fork-wiki/service test
```

## Manual Phase 1 checklist

- Open `/health` and confirm `status` is `ok` with a non-zero `bipCount`.
- Open the frontend and confirm the BIP explorer shows backend records.
- Open an individual BIP and confirm its metadata and source tab load.
- Open BIPs 110, 341, and 360 and confirm “Where People Stand” loads from the
  captured sentiment snapshot.
- Open `/sentiment?bip=110` and confirm it shows the analyzed post count even
  when `totalVotes` is zero.
- Use the demo vote controls and confirm they state that nothing was paid,
  signed, recorded, or published.
- Stop the backend and confirm the frontend shows an error rather than mock BIPs.
- Set `VITE_DATA_MODE=mock`, restart the frontend, and confirm mock mode is
  available only when explicitly selected.
- Confirm the existing Nostr login/signer flow still opens.
- Request a missing BIP and confirm the backend returns HTTP 404.

## Rollback

Phase 1 does not move or delete any existing service. To roll back, revert the
Phase 1 commit. Local files under `data/`, `.venv/`, and `.env` are ignored and
may be removed separately without affecting source history.
