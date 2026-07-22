# soft-fork-wiki

**Understand Bitcoin BIPs in plain language — and tell the network what you think.**

Built at [Bitcoin++ Toronto](https://btcpp.dev/toronto). The goal: let a
non-technical person ask an LLM *"what is this Bitcoin proposal?"*, get a plain
explanation, then form and share an opinion (in favour / against) over
[Nostr](https://nostr.com). On top of that we surface **what the Nostr network
already thinks** about each BIP via sentiment analysis.

## The product, end to end

1. **Explain** — user picks a BIP; an LLM explains it in plain terms. *(backend + explainer)*
2. **Opine** — user reacts *in favour / against*; we capture that as a signal on Nostr, including **zap-to-vote** (Lightning). *(voting — MorningRevolution)*
3. **Aggregate** — we run **sentiment analysis** over public Nostr discussion of each BIP: "what does the network think about BIP 110?" *(sentiment — MorningRevolution)*
4. **Surface** — a frontend ties it together, connected to Nostr via Shakespeare. *(frontend)*
5. **Analytics** — dashboards over the captured opinions + sentiment. *(analytics)*

## Areas & folders

| Area | Owner | Folder |
|------|-------|--------|
| BIP source data + LLM explainer | TumaBitcoiner | `src/backend` |
| Frontend (Shakespeare + Nostr) | — | frontend |
| Zap-to-vote / opinion capture | MorningRevolution | [`packages/voting`](packages/voting) |
| Sentiment analysis + analytics | MorningRevolution | [`packages/sentiment`](packages/sentiment) |
| Shared types & Nostr constants | all | [`packages/shared`](packages/shared) |

> Each area owns a folder. Import shared types from
> [`@soft-fork-wiki/shared`](packages/shared) so the frontend, voting, and
> sentiment services all speak the same shapes.

## Stack

TypeScript everywhere. Nostr and Lightning zaps are JS-first
(`nostr-tools` / NDK), so keeping one language means the frontend and our
services can share Nostr client code and types with no cross-language glue.
Sentiment classification is provider-agnostic — a pluggable interface with
**Claude (Haiku 4.5)** and **Gemini 2.5 Flash** backends — so no separate ML
stack, and we can compare providers on the same task.

## Getting started

```bash
# requires Node 20+ and pnpm (npm i -g pnpm)
pnpm install

# run a package's dev script
pnpm --filter @soft-fork-wiki/sentiment dev
pnpm --filter @soft-fork-wiki/voting dev
```

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for how the pieces connect,
the Nostr event model, and the zap-to-vote design.

## Integrating with voting + sentiment

Frontend contract — exports, the signing rules, and what's still blocked:
[`docs/AGENTS.md`](docs/AGENTS.md).
