# Architecture

How the pieces fit, the Nostr event model, and the voting design.

> The Nostr specifics below are now backed by a deep-research pass over the NIPs
> (see "Research notes" at the end), not just assumptions.

## Flow

```
                 ┌────────────────────────┐
   BIP data ────▶│  backend (BIPs API)    │  BIP index + LLM plain-language
                 │  LLM explainer         │  explanation
                 └───────────┬────────────┘
                             │ Bip { number, title, plainSummary, ... }
                             ▼
   user  ───▶  ┌────────────────────────┐
              │  frontend               │  "What is BIP 110?" -> explanation
              │  Shakespeare + Nostr    │  "In favour / against?" -> capture
              └───────┬────────────┬────┘
                      │            │
         vote / zap   │            │  network sentiment
                      ▼            ▼
      ┌───────────────────┐   ┌──────────────────────┐
      │ voting            │   │ sentiment            │
      │ poll + zap        │   │ fetch Nostr notes    │
      │ capture on Nostr  │   │ classify + aggregate │
      └─────────┬─────────┘   └──────────┬───────────┘
                │ OpinionTally            │ SentimentSummary
                └──────────┬──────────────┘
                           ▼
                 ┌────────────────────────┐
                 │  analytics dashboard   │  per-BIP: votes + zapped sats
                 │                        │  + network sentiment
                 └────────────────────────┘
```

Everything shares types from [`@soft-fork-wiki/shared`](../packages/shared):
`Bip`, `Opinion`, `OpinionTally`, `ClassifiedNote`, `SentimentSummary`.

## Three signals per BIP

1. **The vote — a NIP-88 poll** (`kind:1068` poll, `kind:1018` response). This is
   the standard, **free, two-sided** primitive: favour / against / neutral, one
   vote per pubkey (latest response wins). It's the clean way to capture for/
   against — no payment required, and opposition is a first-class option.
   *(Also supported: a plain `kind:1` opinion note with a stance label, for reach
   in normal Nostr clients — see `voting/opinion.ts`.)*
2. **Zap = paid intensity** (`voting/zap.ts`, NIP-57). A Lightning zap puts sats
   behind a stance. We give each BIP two zap targets (FOR / AGAINST anchors) so
   sats can weight either side, and the tally reports zapped sats **per side**.
   Zaps are the *conviction* layer on top of the poll, **not** the vote itself —
   see the caveat below.
3. **Network sentiment** (`sentiment/`) — we don't wait for people to use our
   app. We fetch existing public discussion of a BIP and classify it, so we can
   show "what the network already thinks" from day one.

### Poll vs zap — why the poll is the vote

| Property | NIP-88 poll | Zap-to-vote (NIP-57) |
|---|---|---|
| Cost to cast | Free | Real sats |
| Two-sided (for/against)? | **Yes**, native | Only via our two-target hack |
| Sybil resistant? | No (npubs are free) | **No** either — a zap ≠ proof of unique human |
| Extra signal | one vote per pubkey | **sats weight** (conviction) |

The research is explicit: **zaps do not provide sybil resistance**, and a
sats-weighted "Zap Poll" (NIP-69) was proposed but never merged. So we use the
**NIP-88 poll as the vote** and **zaps as a paid intensity signal** layered on
top. Neither is sybil-proof; the honest presentation pairs both with the
LLM-derived network sentiment.

## Nostr event model (research-backed)

| Purpose | Kind | Notes |
|---|---|---|
| Discussion (short) | 1 (NIP-01) | Tagged `["t","bip110"]` — lowercase per NIP-24; `#t` is relay-indexed |
| Discussion (long-form) | 30023 (NIP-23) | Same `t` tag; deeper write-ups |
| Poll (the vote) | 1068 (NIP-88) | Options as `["option","<id>","<label>"]`; question in content |
| Poll response | 1018 (NIP-88) | `["e", pollId]` + `["response","<optionId>"]`; one per pubkey |
| Zap request | 9734 (NIP-57) | Signed, sent to LNURL callback; `["e"/"a"/"k",...]` attaches it to a note/BIP; we add a stance label |
| Zap receipt | 9735 (NIP-57) | Published by the LN server; embeds the zap request; we parse it into a vote |
| Reaction | 7 (NIP-25) | Optional lightweight +/- |

Constants live in [`packages/shared/src/nostr.ts`](../packages/shared/src/nostr.ts).

## Finding BIP discussion

- Query `{"kinds":[1,30023], "#t":["bip110"]}` on general relays — `#t` filters
  are relay-indexed (NIP-01), so this is cheap and works everywhere.
- Hashtag values must be **lowercase** (NIP-24), so `bip110`, not `BIP110`.
- Full-text/keyword search needs a **NIP-50** relay (most relays don't implement
  it) — e.g. `relay.nostr.band`. Our default relay list is a starting point;
  add a NIP-50 relay when we want keyword discovery beyond the `t` tag.

## Sentiment engine (multi-provider)

`fetch -> classify -> summarize`, with the classifier behind a
`SentimentClassifier` interface. Two backends today:

- **Claude** — `claude-haiku-4-5` (fast/cheap; right tier for per-note 3-way
  classification).
- **Gemini** — `gemini-2.5-flash` (the analogous fast tier).

Same prompt and same JSON schema feed both, so we can run either — or both, to
compare — for a demo. Neither needs a heavier model (Opus / Gemini Pro) for a
short-post stance classification.

## Research notes

From a deep-research pass over the NIPs (TypeScript stack, `nostr-tools`/NDK):

- **NIP-88** (`kind:1068`/`1018`) is the current standard poll: free, public,
  one-vote-per-pubkey, unweighted. Best fit for favour/against/neutral.
- **NIP-57** zaps = `kind:9734` request (signed, sent to LNURL, *not* published)
  → `kind:9735` receipt (published after payment). `e`/`a`/`k` tags attach a zap
  to a specific note or addressable event. Zaps are **not** sybil-resistant.
- **NIP-69** "Zap Polls" (sats-weighted voting) was proposed but **never merged**.
- Discovery: lowercase `t` tag (NIP-24) on `kind:1`+`kind:30023` (NIP-23),
  indexed `#t` filters (NIP-01); full-text needs NIP-50 relays (`relay.nostr.band`).
- Libraries: `nostr-tools` (what we use) or NDK (`@nostr-dev-kit/ndk`) for
  events/relays/zaps/LNURL.

### Next build steps (from the research)

- Add a `poll.ts` to `voting`: build a `kind:1068` poll per BIP (For / Against /
  Neutral options) and tally `kind:1018` responses (one per pubkey).
- Keep zaps as the intensity layer; attach the zap to the poll/anchor via `e`.
- Add a NIP-50 relay to `sentiment` for keyword discovery beyond the `t` tag.
