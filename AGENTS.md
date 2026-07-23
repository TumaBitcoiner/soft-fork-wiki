# Frontend development instructions

The frontend lives in `src/frontend`. Do not move it to the repository root.

## First-time setup

Run these commands from the repository root:

```bash
npm --prefix src/frontend install
cp src/frontend/.env.example src/frontend/.env
```

The default frontend configuration uses the local API:

```text
VITE_DATA_MODE=http
VITE_API_BASE_URL=http://localhost:8000
```

Start the FastAPI backend before testing real BIP data. See
`LOCAL_DEVELOPMENT.md` for backend setup.

## Run the frontend

From the repository root:

```bash
npm --prefix src/frontend run dev
```

Open:

```text
http://localhost:5173
```

Alternatively, after completing the full local setup, start both the frontend
and backend with:

```bash
npm run dev
```

## Explicit mock mode

Mock data is available only when explicitly configured. Set the following in
`src/frontend/.env`, then restart Vite:

```text
VITE_DATA_MODE=mock
```

Do not add mock fallbacks to HTTP mode.

## Validate frontend changes

Run:

```bash
npm --prefix src/frontend test
```

This performs TypeScript checking, ESLint validation, unit tests, and a
production build. Frontend work is not complete until this command passes.
