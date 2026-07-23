# @soft-fork-wiki/service — sentiment over HTTP

**Owner: MorningRevolution**

A tiny `node:http` service that serves BIP sentiment to the browser.

`GET /sentiment/:bipNumber` returns **exactly** the `SentimentData` shape the
React app already declares in `src/frontend/src/api/types.ts`, so wiring it up
is a one-line change in `httpProvider.ts`.

## Two modes, and the default is `zaps`

```
GET /sentiment/300                     (default, mode=zaps)
  -> read poll responses + opinion notes + verified zap receipts   (relays)
  -> money-weighted score + headcount counts                       (arithmetic)
  -> map onto the frontend contract                                (adapter.ts)
  MEASURED 0.45-0.77s warm, ~2ms on a cache hit. No LLM. No API key.

GET /sentiment/300?mode=llm            (opt-in)
  -> fetch #bip300 notes -> LLM-classify each -> aggregate   (sentiment pkg)
  -> read the vote tally alongside                           (voting pkg)
  -> map onto the same contract                              (adapter.ts)
  Tens of seconds. One model call per note. Needs an API key.
```

**There is no fallback in either direction.** Every response states which
pipeline produced it, in the body (`"mode"`) and in the `X-Sentiment-Mode`
response header. A caller must never have to guess, and a silent substitution
would turn the number on screen into a guess.

The default is `zaps` because the product's claim — the market decides — is
already fully expressed by structured events on the relays: NIP-88 poll
responses, app-tagged opinion notes, and verified NIP-57 zap receipts. Reading
those is two relay round trips and some arithmetic. `SENTIMENT_MODE=llm` moves
the default if you want it the other way round.

## Run

```bash
pnpm install                                   # from src/sentiment/
pnpm --filter @soft-fork-wiki/service dev      # no API key needed for zaps mode
curl http://localhost:8002/health
curl http://localhost:8002/sentiment/300
curl "http://localhost:8002/sentiment/300?mode=llm"     # needs ANTHROPIC_API_KEY
```

## Endpoints

### `GET /sentiment/:bipNumber`

| Status | When | Body |
| --- | --- | --- |
| 200 | ok | `SentimentData` (below) |
| 400 | `:bipNumber` is missing, non-numeric, or out of range | `{ "error": "invalid_bip_number", … }` |
| 400 | `?mode=` is not `zaps` or `llm` | `{ "error": "invalid_mode", … }` |
| 404 | unknown path | `{ "error": "not_found", … }` |
| 405 | method other than GET/HEAD/OPTIONS | `{ "error": "method_not_allowed", … }` |
| 502 | the **LLM** path failed | `{ "error": "sentiment_unavailable", "message": "…", "bipNumber": 300, "mode": "llm" }` |

The zap path never returns 502. Relay trouble degrades to zeros with
`degraded: true` — see "Empty and degraded" below.

Query params:

- `?mode=zaps` (default) \| `?mode=llm` — pick the pipeline explicitly. `zap`
  is accepted as a spelling of `zaps`.
- `?refresh=1` — drop that mode's cached entry and recompute. On `mode=llm`
  this **costs LLM tokens**; on the default it costs one relay read.

### Response, `mode: "zaps"`

First eight fields are the frontend contract; the rest is additive and safely
ignored by the current UI.

```json
{
  "bipNumber": 300,
  "against": 65,
  "neutral": 12,
  "for": 23,
  "totalVotes": 18,
  "totalSats": 100000,
  "score": 80,
  "recentNotes": [
    {
      "author": "npub1zyg3…sl3h",
      "choice": "For",
      "note": "Sidechains without a soft fork, finally.",
      "time": "2m"
    }
  ],

  "mode": "zaps",
  "scoreBasis": "sats",
  "hasSignal": true,
  "satsScore": 80,
  "voteScore": -41,
  "degraded": false,
  "totalSatsFor": 90000,
  "totalSatsAgainst": 10000,
  "counts": { "favour": 4, "against": 11, "neutral": 2 },
  "sampleSize": 2,
  "uniqueVoters": 18,
  "narrative": "",
  "computedAt": 1784820177,
  "zapAudit": {
    "trust": "lnurl",
    "accepted": 6,
    "rejected": 1,
    "rejectedSats": 1000000,
    "skipped": 0
  },
  "elapsedMs": 455,
  "relays": ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net", "wss://nostr.wine"],
  "relaysAnswered": ["wss://nos.lol", "wss://relay.primal.net", "wss://nostr.wine"]
}
```

That example is the point of the product: **money says +80, headcount says
−41.** Both signals are always present so the divergence is visible.

- `score` — the gauge, −100..+100. In `zaps` mode it is money-weighted:
  `(satsFor − satsAgainst) / (satsFor + satsAgainst) × 100` over **verified**
  receipts. Same number as `satsScore`.
- `satsScore` — money-weighted, or `null` when no sats were zapped either way.
- `voteScore` — headcount over `counts`, or `null` when `counts` is empty.
  Neutral votes are in the denominator, so a mostly-undecided electorate reads
  as low conviction rather than a landslide.
- `against` / `neutral` / `for` are **percentages** of `counts`, because the UI
  feeds them straight into the widths of a three-segment bar.
- `counts` in `zaps` mode is **free votes only** — poll responses and opinion
  notes. Zapped sats are the other half of the display, deliberately kept apart.
- `totalVotes` is `uniqueVoters`: distinct pubkeys across poll responses,
  opinion notes and zaps, deduplicated. Not a sample size.
- `recentNotes` are **stated** opinions (kind:1 + `#softforkwiki` + a NIP-32
  stance label), not scraped chatter and not LLM-classified.
- `narrative` is `""`. Nothing wrote one; inventing a sentence here would be the
  service pretending it did work it did not do.
- `zapAudit` answers "why didn't my zap move the needle?" on the spot. A receipt
  refused by the `lnurl` policy appears as `rejected` with its claimed sats in
  `rejectedSats`, rather than vanishing.

### Response, `mode: "llm"`

Same shape, with `"mode": "llm"`, `"scoreBasis": "notes"`, a real `narrative`,
`counts`/`sampleSize` from the classified notes, and no `zapAudit` /
`elapsedMs` / `relays*`. `score` is the classifier's `netScore` rescaled to
−100..+100, and `satsScore` is still reported alongside.

### Empty and degraded

Zero is not an answer. "Nobody has weighed in" and "opinion is exactly split"
both render as `score: 0` and mean opposite things, so **branch on these, not on
`score === 0`**:

| Field | Meaning |
| --- | --- |
| `hasSignal: false` | Nothing at all was found: no sats, no votes, no notes. Show an empty state. |
| `scoreBasis: "none"` | `score` is a placeholder, not a measurement. |
| `satsScore: null` | No sats moved either way. (`0` means equal sats on both sides — a genuinely contested proposal.) |
| `voteScore: null` | Nobody cast a free vote. |
| `degraded: true` | **Not one** relay completed a read, so even the zeros are unbacked. |

Today, with no votes or zaps published yet, every BIP returns exactly this:

```json
{ "bipNumber": 300, "against": 0, "neutral": 0, "for": 0, "totalVotes": 0,
  "totalSats": 0, "score": 0, "recentNotes": [], "mode": "zaps",
  "scoreBasis": "none", "hasSignal": false, "satsScore": null,
  "voteScore": null, "degraded": false, … }
```

`degraded` is deliberately strict. A single slow relay does **not** set it —
with the default relay set that would be true on nearly every request, and a
flag that is always on is a flag nobody reads. Compare `relays` with
`relaysAnswered` for that detail; the missing one is almost always
`relay.damus.io`.

### `GET /health`

```json
{
  "status": "ok",
  "service": "@soft-fork-wiki/service",
  "uptimeSeconds": 42,
  "mode": "zaps",
  "availableModes": ["zaps", "llm"],
  "provider": "default",
  "ttlMs": 900000,
  "zapTtlMs": 5000,
  "zapBudgetMs": 1500,
  "zapTrust": "lnurl",
  "relays": "default",
  "cache": { "zaps": { "entries": 3, "inflight": 0 },
             "llm":  { "entries": 0, "inflight": 0 } }
}
```

`mode` is the pipeline a request without `?mode=` gets. Never includes an API
key — only the provider *name*.

## Environment

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8002` | Listen port. 8000/8001 are the Python backends. |
| `SENTIMENT_MODE` | `zaps` | Default pipeline: `zaps` \| `llm`. |
| `SENTIMENT_ZAP_TTL_MS` | `5000` | Cache TTL for zap mode. **Seconds, not minutes** — somebody will zap on stage. Capped at 5 min. |
| `SENTIMENT_ZAP_BUDGET_MS` | `1500` | Wall-clock ceiling on all relay reads behind one zap response. `900` measures ~0.45s end to end. |
| `SENTIMENT_ZAP_TRUST` | `lnurl` | Zap receipt policy: `lnurl` \| `structural` \| `none`. **Only `lnurl` resists forgery.** |
| `SENTIMENT_LNURL_TIMEOUT_MS` | `2500` | Per-request budget for one LNURL-pay lookup. |
| `SENTIMENT_VOTE_LIMIT` | `500` | Max vote/zap events pulled per kind in zap mode. |
| `SENTIMENT_TTL_MS` | `900000` (15 min) | Cache TTL for LLM mode. `0` disables caching. |
| `SENTIMENT_NOTE_LIMIT` | `100` | Max notes pulled per LLM analysis — **one LLM call each**. |
| `SENTIMENT_RECENT_NOTES` | `8` | How many notes appear in `recentNotes`. |
| `SENTIMENT_PROVIDER` | `claude` | `claude` \| `gemini`. LLM mode only. |
| `SENTIMENT_RELAYS` | `DEFAULT_RELAYS` | Comma-separated relay override. |
| `ANTHROPIC_API_KEY` | — | Required for `?mode=llm` with the Claude provider. |
| `GEMINI_API_KEY` | — | Required for `?mode=llm` with the Gemini provider. |

A malformed numeric/enum value fails at boot rather than defaulting silently.

## Why the zap path is fast — measured, not estimated

Three things, all in `relays.ts` and `opinions.ts`:

1. **One long-lived relay pool.** `voting/NostrClient` builds and closes a
   `SimplePool` per call, so every request pays four TLS/WebSocket handshakes.
   Here the pool is process-wide, warmed at boot, with `idleTimeout` raised from
   the library's 20 seconds to 10 minutes — otherwise a demo that pauses between
   clicks reconnects on the next one, and connect time is *not* covered by
   `maxWait`.
2. **Filter on the app tag, not the BIP hashtag.** NIP-01 ANDs different tag
   keys but ORs values inside one, so `#t: ["bip110", "softforkwiki"]` would
   *widen* the query. Measured: `#t: ["bip110"]` returns 500 kind:1 events from
   nos.lol in 2.35s and 310 from relay.damus.io in 2.64s; `#t: ["softforkwiki"]`
   returns only what this app published. The BIP is applied in memory.
3. **Every read on a shared clock**, sliced across the two hops so hop one
   cannot spend the whole budget. Measured per-relay EOSE for a `#t` filter:
   nostr.wine 48-171ms, relay.primal.net 145-262ms, nos.lol 151-278ms,
   **relay.damus.io 1.8-4.4s** — and per `shared/nostr.ts` damus returns nothing
   for `#t` lookups anyway. It gets cut off and reported, never waited for.

Measured end to end against live relays (Windows, home broadband, warm pool,
`?refresh=1` so the cache is bypassed every time):

| BIP | cold first hit | warm, 8 runs | cache hit |
| --- | --- | --- | --- |
| 300 | 0.77s | 0.41–0.77s | ~2ms |
| 444 | 0.76s | 0.62–0.77s | ~2ms |
| 110 | 0.75s | 0.57–0.77s | ~2ms |

With `SENTIMENT_ZAP_BUDGET_MS=900`: 0.38–0.47s, still 3 of 4 relays answering.

## Caching

`cache.ts` is TTL + single-flight (concurrent requests for the same key share
one in-flight promise). **Each mode has its own cache instance** with its own
TTL — 5s for zaps, 15min for the LLM — so a `?mode=llm` request can never be
served a zap-shaped body or vice versa, whatever the TTLs are set to.

Failures are not cached: a rate-limited key should not poison an entry for a
full TTL. Per-process, in-memory, no LRU bound; fine for a handful of BIPs.

## Zap receipts are verified before they count

`voting/parseZapReceipt` reports what a receipt *claims*. A kind:9735 event is
just an event — anyone can sign one claiming a million sats moved. When sats
drive the gauge, summing unverified receipts does not make it noisy, it deletes
it: forging is free, so the needle belongs to whoever is willing to lie.

`zaptrust.ts` applies the NIP-57 bar and defaults to `"lnurl"`: the receipt
verifies, the zap request embedded in its `description` verifies, the `P` tag
agrees with it, and the receipt's author equals the `nostrPubkey` the
**recipient's own** LNURL-pay endpoint advertises. Demonstrated, not assumed: a
self-signed receipt carrying a self-signed request for 1,000,000 sats is
accepted under `none` and `structural`, and refused under `lnurl` with
`rejected: 1, rejectedSats: 1000000`.

Cost is one kind:0 read plus one HTTPS GET per **distinct recipient** — a BIP
has two zap anchors, so two lookups, memoised process-wide for 10 minutes.
With zero zaps it costs nothing.

## Files

- `config.ts` — env parsing. Reads no API keys, on purpose.
- `adapter.ts` — our types -> the frontend contract, plus the two score
  functions. Every naming/units mismatch is resolved here and nowhere else.
- `zaps.ts` — the default path: relay signals -> `SentimentData`. Never throws.
- `opinions.ts` — poll responses + opinion notes + verified zap receipts ->
  `OpinionSignals` (votes, sats, notes, audit trail).
- `zaptrust.ts` — NIP-57 receipt validation and the LNURL provider memo.
- `relays.ts` — the shared pool, warmup, and deadline-bounded reads.
- `analyze.ts` — the LLM path: fetch -> classify -> summarize -> tally.
- `cache.ts` — TTL + single-flight.
- `redact.ts` — strips credentials from anything logged or returned.
- `server.ts` — routing, mode selection, CORS, status codes.
- `main.ts` — binds the port, warms the relays, closes them on exit.

## Wiring the frontend

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

CORS is permissive (`Access-Control-Allow-Origin: *`), `OPTIONS` preflights are
answered, and `X-Sentiment-Mode` is in `Access-Control-Expose-Headers` so the
browser can read it.

## Known gaps

- **The panel hides itself when nobody has voted.** `BipPages.tsx` renders the
  "No one has weighed in yet" empty state on `totalVotes === 0`. That is the
  correct state today — nobody has voted on anything — but it means the demo
  shows the empty state unless a couple of votes/zaps are seeded first, or the
  frontend switches its condition to `hasSignal`.
- **A zap receipt does not have to carry `#bip<N>`.** NIP-57 requires the
  receipt to copy the request's `p` and (optional) `e` tags; `t` tags are not
  required and most LN providers drop them. So the receipt query runs on **two**
  routes — the app tag (for providers that do copy it) and `#e` against the
  poll id and opinion note ids (which providers must copy). A zap aimed at an
  anchor neither of those routes knows about is still invisible. Pinning the
  per-BIP anchor ids down (`docs/AGENTS.md` "Open items 1") would close this.
- **`lud06` recipients are rejected.** Decoding a bech32 LNURL needs a
  dependency this service does not have, so those receipts fail the `lnurl`
  policy rather than being waved through. Same gap as
  `sentiment/engagement.ts` and `voting/lnurl.ts`.
- **LLM mode fails silently per note.** `sentiment/classify.ts` catches and logs
  each classification failure, so a missing API key yields `sampleSize: 0` and a
  200, not an error. It is now at least *visible*: `scoreBasis: "none"` and
  `hasSignal: false` rather than a confident-looking `score: 0`.
- **`submitSentiment` is not implemented.** Writes require the user's Nostr key
  and stay in the browser. This service is read-only by design.
- **No BIP title context.** `classifyNotes` accepts an optional `bipTitle` that
  sharpens classification; we do not have a BIP metadata source here yet.
