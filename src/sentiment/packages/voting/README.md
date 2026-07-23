# @soft-fork-wiki/voting — opinion capture + zap-to-vote

**Owner: MorningRevolution**

Captures a user's stance on a BIP and records it on Nostr. Three mechanisms:

1. **NIP-88 poll — the vote** (`poll.ts`). A `kind:1068` poll with For / Against
   / Neutral options; each vote is a `kind:1018` response. Free, two-sided, one
   vote per pubkey (latest wins). This is the primary favour/against capture.
2. **Zap — paid intensity** (`zap.ts`, NIP-57). A Lightning zap puts sats behind
   a stance via two targets (FOR / AGAINST anchors). The tally reads zapped sats
   per side. Zaps are the conviction layer, not the vote (they aren't
   sybil-resistant — see `docs/architecture.md`).
3. **Opinion note** (`opinion.ts`) — a free `kind:1` note with a stance label,
   for reach in normal Nostr clients.

## Modules

- `nostr.ts` — relay pool + publish/subscribe helpers (wraps `nostr-tools`).
- `poll.ts` — build a NIP-88 poll + responses; tally one-vote-per-pubkey.
- `opinion.ts` — build & publish an opinion note; parse them back out.
- `zap.ts` — build a NIP-57 zap request and interpret zap receipts as votes.
- `tally.ts` — aggregate opinions + zaps into an `OpinionTally` for analytics.
- `demo.ts` — runnable smoke test (`pnpm --filter @soft-fork-wiki/voting dev`).

> Event-kind and tag choices are stubbed against known NIPs. Confirm the exact
> zap-to-vote wiring against the research report before demo day.
