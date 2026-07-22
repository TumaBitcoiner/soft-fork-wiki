# @soft-fork-wiki/voting — opinion capture + zap-to-vote

**Owner: Miguel**

Captures a user's stance on a BIP and records it on Nostr. Two mechanisms:

1. **Opinion event** — a simple, free signal (favour / against / neutral)
   published as a Nostr event tagged with the BIP.
2. **Zap-to-vote** — a Lightning zap (NIP-57) that puts sats behind a stance.
   Two-sided: each BIP has a FOR anchor and an AGAINST anchor, so a zap can
   express either side. The zap request carries a stance label; the tally reads
   both vote count and zapped sats per side. See `docs/architecture.md` for the
   design and tradeoffs (sybil resistance vs. cost, and where "against" sats go).

## Modules

- `nostr.ts` — relay pool + publish/subscribe helpers (wraps `nostr-tools`).
- `opinion.ts` — build & publish an opinion event; parse them back out.
- `zap.ts` — build a NIP-57 zap request and interpret zap receipts as votes.
- `tally.ts` — aggregate opinions + zaps into an `OpinionTally` for analytics.
- `demo.ts` — runnable smoke test (`pnpm --filter @soft-fork-wiki/voting dev`).

> Event-kind and tag choices are stubbed against known NIPs. Confirm the exact
> zap-to-vote wiring against the research report before demo day.
