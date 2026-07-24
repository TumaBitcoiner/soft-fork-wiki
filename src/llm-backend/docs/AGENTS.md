# Soft Fork BIPs LLM Backend

## Purpose
This service reads BIP content from the existing SQLite database and uses the
ppq LLM endpoint to generate a non-technical explanation. Explanations are
cached in a dedicated SQLite database.

## Requirements
- Python 3.10+
- The BIP DB created by the main backend
- A `config.json` in the repo root

## Configuration
The service reads `config.json` from the repo root.

Required keys:
- `bips_db_path` (path to the existing BIP DB, e.g. `./bips.sqlite`)
- `ppq_api_key`

Optional keys:
- `explain_db_path` (default `./bips_explain.sqlite`)
- `ppq_model` (default `ppq-default`)
- `prompt_version` (default `v1`)
- `summary_words` (default `250`)

## Install
```
pip install -r src/llm-backend/requirements.txt
```

## Run
```
uvicorn app.main:app --app-dir src/llm-backend --reload
```

## Endpoints
- `POST /explain`
  - Body: `{ "bip_number": 360 }`
  - Returns cached explanation if present, otherwise generates and caches

- `POST /explain/refresh`
  - Body: `{ "bip_number": 360 }`
  - Always generates a new explanation and overwrites cache for the current
    prompt version

- `POST /ask`
  - Body: `{ "bip_number": 360, "question": "..." }`
  - Returns cached answer if present, otherwise generates and caches

- `GET /last-answer/{bip_number}`
  - Returns the most recent answer stored for the BIP and model/prompt version

## Notes
- The ppq endpoint used is `POST https://api.ppq.ai/chat/completions`.
- Authorization uses the `Authorization: Bearer <API_KEY>` header.
- Explanations are stored per `(bip_number, model, prompt_version)`.
- Answers are stored per `(bip_number, question_hash, model, prompt_version)`.
- The last answer cache is stored per `(bip_number, model, prompt_version)`.
