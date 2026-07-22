# Architecture

How the pieces fit, the Nostr event model, and the zap-to-vote design.

> Nostr specifics below (event kinds, tag conventions, relays) are our working
> assumptions. A deep-research report on Nostr BIP-discussion and zap-to-vote is
> being folded in — see the "Open questions" section and expect this doc to
> tighten as findings land.

## Flow

```
                 ┌────────────────────────┐
   BIP data ────▶│  data (Tuma)           │  BIP index + LLM plain-language
                 │  LLM explainer         │  explanation
                 └───────────┬────────────┘
                             │ Bip { number, title, plainSummary, ... }
                             ▼
   user  ───▶  ┌────────────────────────┐
              │  frontend (Hugo)        │  "What is BIP 110?" -> explanation
              │  Shakespeare + Nostr    │  "In favour / against?" -> capture
              └───────┬────────────┬────┘
                      │            │
         opinion/zap  │            │  network sentiment
                      ▼            ▼
      ┌───────────────────┐   ┌──────────────────────┐
      │ voting (Miguel)   │   │ sentiment (Miguel)   │
      │ opinion + zap     │   │ fetch Nostr notes    │
      │ capture on Nostr  │   │ classify + aggregate │
      └─────────┬─────────┘   └──────────┬───────────┘
                │ OpinionTally            │ SentimentSummary
                └──────────┬──────────────┘
                           ▼
                 ┌────────────────────────┐
                 │  analytics dashboard   │  per-BIP: our votes + zapped sats
                 │  (Miguel / Matthew)    │  + network sentiment
                 └────────────────────────┘
```

Everything shares types from [`@soft-fork-wiki/shared`](../packages/shared):
`Bip`, `Opinion`, `OpinionTally`, `ClassifiedNote`, `SentimentSummary`.

## Two signals per BIP

We capture opinion **two** ways, and read sentiment a **third**:

1. **Explicit opinion** (`voting/opinion.ts`) — a free Nostr note (kind:1)
   tagged with the BIP and a stance label. Anyone can react favour / against /
   neutral at no cost. High reach, low cost-to-fake.
2. **Zap-to-vote** (`voting/zap.ts`) — a Lightning zap (NIP-57) puts sats behind
   support. Costs real money, so it's much harder to sybil — but it's
   **one-sided**: you can only pay to signal *support*, never opposition. We
   treat a zap as a weighted "favour" and report the tally in sats.
3. **Network sentiment** (`sentiment/`) — we don't wait for people to use our
   app. We fetch existing public discussion of a BIP and classify it, so we can
   show "what the network already thinks" from day one.

### Why zap-to-vote, and its tradeoffs

| Property | Free opinion note | Zap-to-vote |
|---|---|---|
| Cost to cast | Free | Real sats (Lightning) |
| Sybil resistance | Low (one npub = one vote, npubs are free) | High (each vote costs money) |
| Can express opposition? | Yes | **No** — zaps only signal support |
| Signal | Vote count | Vote count **and** sats weight |

Because zaps are one-sided, we never read "against" from zaps. The honest way to
present it: *"N people and X sats in favour"* alongside the free-vote tally,
which captures both sides. Sentiment analysis fills the "against" picture from
organic discussion.

## Nostr event model (working assumptions)

| Purpose | Kind | Notes |
|---|---|---|
| Opinion note | 1 (NIP-01) | Tagged `["t","bip110"]`, `["t","softforkwiki"]`, `["l","favour","stance"]` (NIP-32 label) |
| Zap request | 9734 (NIP-57) | Tagged with the BIP; sent to the LNURL callback |
| Zap receipt | 9735 (NIP-57) | Published by the LN server; we parse it back into a vote |
| (Optional) poll | 1068 / 1018 (NIP-88) | A native two-sided poll is an alternative to zap-to-vote for favour/against — under evaluation |

Constants live in [`packages/shared/src/nostr.ts`](../packages/shared/src/nostr.ts).

## Sentiment engine (multi-provider)

`fetch -> classify -> summarize`, with the classifier behind a
`SentimentClassifier` interface. Two backends today:

- **Claude** — `claude-haiku-4-5` (fast/cheap; right tier for per-note 3-way
  classification).
- **Gemini** — `gemini-2.5-flash` (the analogous fast tier).

Same prompt and same JSON schema feed both, so we can run either — or both, to
compare — for a demo. Neither needs a heavier model (Opus / Gemini Pro) for a
short-post stance classification.

## Open questions (research folding in)

- **Finding discussion**: exact tag conventions people use for BIPs on Nostr, and
  which relays carry Bitcoin-protocol discussion. Our `#bipN` + relay list is a
  starting point.
- **Zap-to-vote wiring**: whether to zap a per-BIP account, a canonical per-BIP
  note, or use an existing zap-poll pattern; sybil/cost calibration.
- **Poll vs zap**: whether NIP-88 polls (two-sided) belong alongside zap-to-vote.
