# @soft-fork-wiki/service — sentiment over HTTP

**Owner: MorningRevolution**

A tiny `node:http` service that serves `@soft-fork-wiki/sentiment` to the
browser. Sentiment classification needs an LLM API key, so it cannot run in the
frontend — this is the seam.

`GET /sentiment/:bipNumber` returns **exactly** the `SentimentData` shape the
React app already declares in `src/frontend/src/api/types.ts`, so wiring it up
is a one-line change in `httpProvider.ts`.

```
GET /sentiment/110
  -> fetch #bip110 notes -> LLM-classify each -> aggregate        (sentiment pkg)
  -> read poll responses + opinion notes + zap receipts -> tally  (voting pkg)
  -> map onto the frontend contract                               (adapter.ts)
```

## Run

```bash
pnpm install                                    # from src/sentiment/, links nostr-tools
ANTHROPIC_API_KEY=... pnpm --filter @soft-fork-wiki/service dev
curl http://localhost:8002/health
curl http://localhost:8002/sentiment/110
```

## Endpoints

### `GET /sentiment/:bipNumber`

| Status | When | Body |
| --- | --- | --- |
| 200 | ok | `SentimentData` (below) |
| 400 | `:bipNumber` is missing, non-numeric, or out of range | `{ "error": "invalid_bip_number", "message": "…" }` |
| 404 | unknown path | `{ "error": "not_found", "message": "…" }` |
| 405 | method other than GET/HEAD/OPTIONS | `{ "error": "method_not_allowed", "message": "…" }` |
| 502 | relays or the LLM provider failed | `{ "error": "sentiment_unavailable", "message": "…", "bipNumber": 110 }` |

Query params:

- `?refresh=1` — drop the cached entry and recompute. **Costs LLM tokens.**

Response body (first eight fields are the frontend contract; the rest is
additive and safely ignored by the current UI):

```json
{
  "bipNumber": 110,
  "against": 18,
  "neutral": 34,
  "for": 48,
  "totalVotes": 14,
  "totalSats": 12800,
  "score": 45,
  "recentNotes": [
    {
      "author": "npub14242…rcaj",
      "choice": "For",
      "note": "Makes light clients cheaper — I'm for it.",
      "time": "5h"
    }
  ],

  "totalSatsFor": 11000,
  "totalSatsAgainst": 1800,
  "counts": { "favour": 30, "against": 11, "neutral": 21 },
  "sampleSize": 62,
  "uniqueVoters": 14,
  "narrative": "Discussion is broadly supportive, with concerns about …",
  "computedAt": 1753000000
}
```

Field notes:

- `against` / `neutral` / `for` are **percentages** (0..100, summing to 100),
  because the UI feeds them straight into the widths of a three-segment bar.
  Absolute counts are in `counts`.
- `score` is our `netScore` rescaled from `-1..+1` to `-100..+100`; the UI
  prints it signed (`+45`).
- `choice` is `"For" | "Against" | "Neutral"` — our lowercase
  `"favour" | "against" | "neutral"` is translated in `adapter.ts`.
- `totalSats` is `totalSatsFor + totalSatsAgainst`. The split is kept because a
  proposal at 11k-for/1.8k-against is a very different story from one at
  6.4k/6.4k, and the single number hides that.
- `totalVotes` is the number of **people who actually voted** — distinct
  pubkeys across poll responses, opinion events, and zaps, deduplicated. It is
  not the analyzed sample size; scraped discussion is chatter, not votes, and
  reporting it here would claim 40 votes when two people voted. Notes analyzed
  is `sampleSize`.
- `author` is an abbreviated npub (`npub1` + 4 chars + `…` + last 4), matching
  the mock's `npub1…7k2m` shape. A few chars of the key are kept so two authors
  are distinguishable. A pubkey that fails bech32 encoding falls back to
  truncated hex rather than failing the request.

### `GET /health`

```json
{
  "status": "ok",
  "service": "@soft-fork-wiki/service",
  "uptimeSeconds": 42,
  "provider": "claude",
  "ttlMs": 900000,
  "cache": { "entries": 3, "inflight": 1 }
}
```

Never includes an API key — only the provider *name*.

## Environment

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8002` | Listen port. 8000/8001 are the Python backends. |
| `SENTIMENT_TTL_MS` | `900000` (15 min) | How long a result stays fresh. `0` disables caching. |
| `SENTIMENT_NOTE_LIMIT` | `100` | Max notes pulled per analysis — **one LLM call each**. |
| `SENTIMENT_RECENT_NOTES` | `8` | How many notes appear in `recentNotes`. |
| `SENTIMENT_PROVIDER` | `claude` | `claude` \| `gemini`. |
| `SENTIMENT_RELAYS` | `DEFAULT_RELAYS` | Comma-separated relay override. |
| `ANTHROPIC_API_KEY` | — | Required for the Claude provider (or `ant auth login`). |
| `GEMINI_API_KEY` | — | Required for the Gemini provider. |
| `CLAUDE_MODEL` / `GEMINI_MODEL` | see sentiment pkg | Model override. |

A malformed numeric/enum value fails at boot rather than defaulting silently.

## Wiring the frontend

Set both of these for the frontend dev server:

```bash
# src/frontend/.env.local
VITE_DATA_MODE=http
VITE_API_BASE_URL=http://localhost:8002
```

and change the one line in `src/frontend/src/api/httpProvider.ts`:

```ts
-  getSentiment: (bipNumber) => mockProvider.getSentiment(bipNumber),
+  getSentiment: (bipNumber) => request(`/sentiment/${bipNumber}`),
```

**Caveat:** `httpProvider` has a single `VITE_API_BASE_URL` shared by every
endpoint, and the BIP explorer (`/bips`) is served by the Python backend on a
different port. Pointing the whole base URL here would break the explorer. Two
ways out, frontend's call:

1. Reverse-proxy both behind one origin (Vite `server.proxy`: `/sentiment` ->
   `http://localhost:8002`, everything else -> the Python backend), keep
   `VITE_API_BASE_URL` as-is. **Recommended.**
2. Add a second var, e.g. `VITE_SENTIMENT_BASE_URL=http://localhost:8002`, and
   have `getSentiment` fetch from that base.

CORS is permissive (`Access-Control-Allow-Origin: *`) and `OPTIONS` preflights
are answered, which matters because `httpProvider` sends
`Content-Type: application/json` even on GETs — that alone triggers a preflight.

## Caching

`analyzeBip`-equivalent work is network-bound *and* costs one LLM call per note,
so `cache.ts` does two things:

- serves a result from memory until its TTL expires, and
- **single-flights**: concurrent requests for the same BIP share one in-flight
  promise, so three tabs opening BIP 110 at once trigger one analysis, not
  three.

Failures are not cached — a rate-limited key should not poison an entry for a
full TTL. The cache is per-process and in-memory; there is no LRU bound, which
is fine for the handful of BIPs in the demo.

## Files

- `config.ts` — env parsing. Reads no API keys, on purpose.
- `adapter.ts` — our types -> the frontend contract. Every naming/units
  mismatch is resolved here and nowhere else.
- `analyze.ts` — fetch -> classify -> summarize -> tally for one BIP.
- `opinions.ts` — poll responses + opinion notes + zap receipts ->
  `OpinionTally` (the votes and the sats).
- `cache.ts` — TTL + single-flight.
- `redact.ts` — strips credentials from anything logged or returned.
- `server.ts` — routing, CORS, status codes.
- `main.ts` — binds the port.

## Known gaps

- **The panel hides itself when nobody has voted.** `BipPages.tsx` renders the
  "No one has weighed in yet" empty state on `totalVotes === 0`. Now that
  `totalVotes` counts real votes only, a BIP with plenty of analyzed discussion
  but no in-app votes shows nothing — the sentiment work is invisible. If the
  frontend wants the analysis visible regardless, that condition should key off
  `sampleSize` (returned for exactly this reason). Otherwise, seed a couple of
  votes before demoing.
- **Zap receipts may not carry `#bip<N>`.** We query receipts by that hashtag,
  but a NIP-57 receipt is published by the LN server and only reliably copies
  `p`/`e`/`description`. Until the zap target from
  `docs/AGENTS.md` "Open items 1" is pinned down, `totalSats` can legitimately
  read `0` even when zaps exist. A tally failure degrades to zeros rather than
  failing the request.
- **Poll discovery is assumed, not agreed.** Counting NIP-88 votes needs the
  poll event id for a BIP, which `docs/AGENTS.md` "Open item 2" leaves open. We
  discover it by querying kind:1068 tagged `#bip<N>` and keeping the ones that
  also carry `#softforkwiki`. If poll ids end up stored in the backend instead,
  `fetchPollOpinions` is the one function to change.
- **`submitSentiment` is not implemented.** Writes require the user's Nostr key
  and stay in the browser (`@soft-fork-wiki/voting` builds the unsigned event —
  see `docs/AGENTS.md`). This service is read-only by design.
- **No BIP title context.** `classifyNotes` accepts an optional `bipTitle` that
  sharpens classification; we do not have a BIP metadata source here yet.
