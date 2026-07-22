# @soft-fork-wiki/frontend — UI (Shakespeare + Nostr)

**Owner: Hugo**

The user-facing app: browse BIPs, read the plain-language explanation, react
*in favour / against*, and see what the network thinks.

Built with **Shakespeare** (conference sponsor) and connected to **Nostr**.

Integration points:
- Import types from [`@soft-fork-wiki/shared`](../shared) — `Bip`, `Opinion`,
  `SentimentSummary` — so the UI, the voting service, and the sentiment service
  agree on shapes.
- The voting flow (including **zap-to-vote**) is implemented in
  [`@soft-fork-wiki/voting`](../voting). Use its client helpers to publish
  opinions and to build zap requests.
- Network sentiment per BIP comes from
  [`@soft-fork-wiki/sentiment`](../sentiment).

> If the Shakespeare app lives outside this repo, keep a thin adapter or a link
> here so the team can find it.
