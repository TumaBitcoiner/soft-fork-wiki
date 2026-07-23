# Voting + Sentiment — frontend integration

## Purpose
Two TypeScript packages the frontend consumes to (a) capture a user's stance on
a BIP on Nostr and (b) read what the Nostr network already thinks about it.

- `@soft-fork-wiki/voting` — NIP-88 poll, NIP-57 zap, kind:1 opinion note, tally
- `@soft-fork-wiki/sentiment` — fetch BIP discussion, LLM-classify, aggregate
- `@soft-fork-wiki/shared` — the types both sides speak (dependency-free)

**Reads and writes split differently.** `voting` is a browser-safe library the
frontend imports directly — it builds unsigned event templates you sign and
publish. `sentiment` cannot run in a browser (LLM classification needs an API
key), so it is consumed over HTTP like `src/backend` and `src/llm-backend`.

This code lives in `src/sentiment/` and is a self-contained pnpm workspace —
nothing of ours is at the repo root.

## Requirements
- Node 20+ and pnpm (`npm i -g pnpm`)
- A Nostr signer in the browser for anything that publishes (NIP-07
  `window.nostr` extension, or a key the frontend manages)

## Configuration
Only the sentiment package needs keys — the voting package is pure/offline
until you publish.

- `ANTHROPIC_API_KEY` — Claude sentiment backend. Alternatively `ant auth login`
  (the Anthropic CLI) stores a profile the SDK reads, and the env var can stay
  unset.
- `GEMINI_API_KEY` — Gemini sentiment backend
- `SENTIMENT_PROVIDER` (optional): `claude` | `gemini`
- `CLAUDE_MODEL` (optional, default `claude-haiku-4-5`)
- `GEMINI_MODEL` (optional, default `gemini-2.5-flash`)

Relays default to `DEFAULT_RELAYS` from `@soft-fork-wiki/shared`; every function
that touches the network accepts a `relays` override.

## Install
```
pnpm install
```

## Run
```
pnpm --filter @soft-fork-wiki/voting dev        # offline smoke test
SENTIMENT_PROVIDER=claude pnpm --filter @soft-fork-wiki/sentiment dev 110
pnpm -r typecheck
```

## The signing contract — read this first
Every builder returns an **unsigned** `EventTemplate`. The frontend signs it
with the user's identity and publishes. We never hold user keys.

```ts
const template = buildPollResponse({ pollId, stance: "favour", createdAt: now });
const signed = await window.nostr.signEvent(template);   // frontend does this
await pool.publish(relays, signed);
```

`createdAt` is always a caller-supplied unix-seconds number — the builders are
pure so they stay testable. Pass `Math.floor(Date.now() / 1000)`.

## Exports

### Voting — the vote (NIP-88 poll)
- `POLL_OPTIONS` — `[{id:"favour"},{id:"against"},{id:"neutral"}]`; option id **is**
  the `Stance` value
- `buildBipPoll({ bipNumber, bipTitle?, relays?, createdAt, endsAt? })` →
  unsigned `kind:1068`. One poll per BIP, created once; the frontend needs to
  store/lookup the resulting event id.
- `buildPollResponse({ pollId, stance, createdAt })` → unsigned `kind:1018`
- `parsePollResponse(event)` → `ParsedPollResponse | null`
- `tallyPollResponses(pollId, responses)` → `PollTally`
  (one vote per pubkey, **latest response wins** — a user changing their vote is
  handled for you)

### Voting — paid intensity (NIP-57 zap)
- `buildZapRequest({ bipNumber, stance, recipientPubkey, amountMsat, relays,
  zappedEventId?, createdAt, comment? })` → unsigned `kind:9734`.
  `stance` is `"favour" | "against"` only. Stance is stamped as a NIP-32 `l`
  tag under the `stance` namespace.
- `parseZapReceipt(receipt)` → `Opinion | null` (reads stance back out)

The zap request is **not published** — it goes to the LNURL callback, which
returns an invoice; after payment the LN server publishes the `kind:9735`
receipt. The frontend owns that loop (WebLN). See "Open items".

### Voting — reach (plain note)
- `buildOpinionEvent({ bipNumber, stance, comment?, createdAt })` → unsigned
  `kind:1`, tagged `#bip<N>` + `#softforkwiki`, readable in any Nostr client
- `parseOpinion(event)` → `Opinion | null`

### Voting — aggregate
- `tallyOpinions(bipNumber, opinions)` → `OpinionTally`

### Sentiment
- `analyzeBip(bipNumber, { provider?, bipTitle?, relays?, limit?, since?,
  computedAt })` → `Promise<SentimentSummary>` — the one call you probably want
- `fetchBipNotes(bipNumber, { relays?, limit?, since? })` → `Event[]`
  (kind:1 notes tagged `#bip<N>`, deduped, empties dropped, default limit 200)
- `classifyNotes(classifier, bipNumber, notes, bipTitle?)` → `ClassifiedNote[]`
- `summarizeSentiment(...)` → `SentimentSummary`
- `makeClassifier(provider?)` → pluggable `SentimentClassifier`

`analyzeBip` is network + LLM bound — treat it as slow. Cache per BIP; don't
call it on render.

## Data rules
- `Stance` is `"favour" | "against" | "neutral"` everywhere. Zaps are
  favour/against only.
- Every event we publish carries `["t", "bip<N>"]` and `["t", "softforkwiki"]`.
  Lowercase `t` tags are relay-indexed (NIP-24), which is how discovery works.
- Zap amounts are **millisats** on the wire (`amountMsat`); `OpinionTally`
  reports **sats** (`zappedSatsFavour` / `zappedSatsAgainst`).
- `netScore` on `SentimentSummary` is −1 (all against) .. +1 (all in favour).

## Types to import
From `@soft-fork-wiki/shared` — do not redeclare these in the frontend:

`Bip`, `BipStatus`, `BipType`, `bipHashtag(n)`, `Stance`, `Opinion`,
`OpinionSource`, `OpinionTally`, `ClassifiedNote`, `SentimentSummary`,
`NOSTR_KINDS`, `DEFAULT_RELAYS`, `APP_TAG`.

## Notes
- Poll/response kinds are `1068`/`1018`, taken from the merged NIP-88. Wrong
  kind numbers fail silently — relays just return nothing — so don't "fix" them
  casually. Worth one live sanity check before demo.
- `nostr-tools` v2: `SimplePool.subscribeMany(relays, filter, params)` takes a
  **single** `Filter`, not an array.
- Sentiment is typechecked but not exercised live in CI (needs keys + network).
- BIP-322 sign-to-vote was considered and dropped (no first-class BDK support).

## Open items

### 1. Zap target — proposed, needs a nod
`buildZapRequest` needs a target event id + recipient pubkey. Rather than
provisioning separate FOR/AGAINST anchor notes per BIP, **zap the poll event
itself** (`zappedEventId = pollId`) and let the stance `l` tag carry the side.
One less object to create, and it ties intensity directly to the vote. The
frontend still needs a `recipientPubkey` — whose Lightning address receives is
undecided.

### 2. Poll id lookup — needs a path
One `kind:1068` poll per BIP must exist before anyone can respond. Agree on
creation + discovery: query by `#bip<N>` + `#softforkwiki`, or store poll ids
in the backend. Item 1 depends on this.

### 3. BIP source + shape — needs a contract
These packages never fetch BIPs; they take a `bipNumber`. `Bip` objects are
meant to come from the backend's `GET /bips`. To reconcile:
- **Status**: API serves `Draft | Complete`; `BipStatus` has 9 values and uses
  `Final`, not `Complete`. `"Complete"` isn't standard BIP-2 — likely map
  `Complete` ↔ `Final`, or narrow ours to the two the API actually serves.
- **`content`**: API records carry raw BIP markdown/mediawiki; `Bip` has no
  field for it. Add `content?: string`.
- **`Layer`**: API pre-filters to Consensus soft-fork, so it's implied for every
  record we see. Add `layer?` only if we want it explicit.
- **Field naming** isn't pinned in the spec (`bip_number` vs `number`). Once the
  FastAPI service runs, generate TS types from its OpenAPI (`/openapi.json`) so
  there's one source of truth.
- Needs a small TS `bips` HTTP client that fetches and maps to `Bip`.

### 4. `plainSummary` has no producer
`Bip.plainSummary` is the plain-language explanation the UI shows, but the
backend spec serves raw `content` only — no LLM explanation anywhere. Decide:
a server-side `GET /bips/{n}/explain`, or a client-side LLM call over raw
`content`. **This one blocks the core user flow**, not just integration.

### 5. Layout
TS packages live under `packages/` (pnpm workspace); the backend lives under
`src/backend/`. The TS layout predates the backend and was not cross-agreed.
A polyglot repo integrating over HTTP is the natural resolution — zero path
overlap, merges cleanly — but confirming it is the repo owner's call.
