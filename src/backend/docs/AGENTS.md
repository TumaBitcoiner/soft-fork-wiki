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
- `BIPS_REPO_PATH` (required): absolute or relative path to the local BIP repo
- `BIPS_DB_PATH` (optional): SQLite path (default `<repo-root>/bips.sqlite`)

## Install
```
pip install -r src/backend/requirements.txt
```

## Run
```
BIPS_REPO_PATH=/path/to/bitcoin/bips uvicorn app.main:app --app-dir src/backend --reload
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
