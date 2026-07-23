# Soft Fork BIPs API

## Purpose
This backend reads a local clone of the Bitcoin BIPs repo and serves BIPs that
match:

- `Layer: Consensus (soft fork)`
- `Status: Draft`, `Status: Complete`, or `Status: Deployed`

The BIP file content is stored in SQLite and returned by the API.

## Requirements
- Python 3.10+
- Local clone of `https://github.com/bitcoin/bips`

## Configuration
The service reads `config.json` from the repo root.

Required keys:
- `bips_repo_path`

Optional keys:
- `bips_db_path` (default `./bips.sqlite`)

## Install
```
pip install -r src/backend/requirements.txt
```

## Run
```
uvicorn app.main:app --app-dir src/backend --reload
```

On startup, the server scans the repo and upserts matching BIPs into SQLite.

## Endpoints
- `GET /bips`
  - Returns full records including `content`
  - Query params: `status=Draft|Complete|Deployed`, `limit`, `offset`

- `GET /bips/meta`
  - Returns metadata only
  - Query params: `status=Draft|Complete|Deployed`, `limit`, `offset`

- `GET /bips/{bip_number}`
  - Returns a single BIP with full `content`

- `GET /bips/{bip_number}/meta`
  - Returns a single BIP metadata record

## Data rules
- Reads `bip-*.md` and `bip-*.mediawiki`
- Skips files missing `Layer` or `Status`
- Filters to `Layer: Consensus (soft fork)`
- Filters to `Status: Draft`, `Status: Complete`, or `Status: Deployed`

## Notes
- The DB is populated on startup only.
- The repo is not fetched or updated by the server.

## LLM backend (separate service)
The LLM service lives in `src/llm-backend` and provides POST-only endpoints for
cached explanations of BIPs. See `src/llm-backend/docs/AGENTS.md` for details.

### Configuration
The service reads `config.json` from the repo root.

Required keys:
- `bips_db_path` (path to existing BIP DB)
- `ppq_api_key`

Optional keys:
- `explain_db_path` (default `./bips_explain.sqlite`)
- `ppq_model` (default `ppq-default`)
- `prompt_version` (default `v1`)
- `summary_words` (default `250`)

### Run
```
uvicorn app.main:app --app-dir src/llm-backend --reload
```

### Endpoints
- `POST /explain`
  - Body: `{ "bip_number": 360 }`
  - Returns cached explanation when available

- `POST /explain/refresh`
  - Body: `{ "bip_number": 360 }`
  - Always regenerates and overwrites the cached entry
