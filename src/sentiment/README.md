# src/sentiment — opinion capture + network sentiment

**Owner: MorningRevolution**

Our slice of soft-fork-wiki: capture what a user thinks about a BIP on Nostr,
and measure what the Nostr network already thinks about it.

Self-contained. Its own pnpm workspace, its own lockfile, its own tsconfig —
nothing of ours sits at the repo root, so the frontend and the Python backends
can't collide with it.

## Where this sits

| Piece | Path | Port |
|-------|------|------|
| BIPs API (FastAPI + SQLite) | `src/backend` | 8000 |
| LLM explainer (ppq) | `src/llm-backend` | 8001 |
| Frontend (React + Nostrify) | `src/frontend` | — |
| **Opinion + sentiment (this)** | `src/sentiment` | — |

## Layout

```
packages/
  shared/     types + Nostr constants (dependency-free); everyone imports this
  voting/     poll (NIP-88) + zap (NIP-57) + opinion note; tally
  sentiment/  fetch Nostr notes -> classify (pluggable LLM) -> aggregate
docs/AGENTS.md        frontend integration contract — start here
docs/architecture.md  design rationale + Nostr research notes
```

## Getting started

```bash
# from this directory. Node 20+.
pnpm install
pnpm -r typecheck

pnpm --filter @soft-fork-wiki/voting dev        # offline smoke test
SENTIMENT_PROVIDER=claude pnpm --filter @soft-fork-wiki/sentiment dev 110
```

## How it connects to the frontend

The frontend already declares the contract in
`src/frontend/src/api/types.ts` — `getSentiment(bipNumber)` and
`submitSentiment(payload)`, both currently served by the mock provider. Filling
those two in is the integration.

The split that works:

- **Writes** (vote, zap, post) happen in the browser. We hand over *unsigned*
  event templates; the frontend signs with the user's Nostr identity and
  publishes. No keys ever leave the client.
- **Reads** (tally + sentiment) happen server-side. LLM classification needs an
  API key, which can never ship to a browser.

See [`docs/AGENTS.md`](docs/AGENTS.md) for the full contract.

## Stack

TypeScript. Nostr and Lightning zaps are JS-first (`nostr-tools`), so the
frontend and our code share types with no cross-language glue. Sentiment
classification is provider-agnostic — a pluggable interface with **Claude
(Haiku 4.5)** and **Gemini 2.5 Flash** backends — so there's no separate ML
stack and the two can be compared on the same task.
