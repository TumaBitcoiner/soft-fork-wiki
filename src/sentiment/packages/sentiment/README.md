# @soft-fork-wiki/sentiment — network sentiment on BIPs

**Owner: MorningRevolution**

Answers "what does the Nostr network think about BIP N?" by fetching public
discussion, classifying each note's stance with an LLM, and aggregating.

## Pipeline

```
fetch notes tagged #bipN  ->  classify each (favour/against/neutral)  ->  aggregate -> SentimentSummary
   (fetch.ts, nostr-tools)     (providers/*, pluggable LLM)             (summarize.ts)
```

- `fetch.ts` — pull kind:1 notes that mention a BIP from relays, by `t` tag.
- `providers/` — a pluggable `SentimentClassifier` interface with two backends:
  - `claude.ts` — Anthropic (`claude-haiku-4-5`), JSON output.
  - `gemini.ts` — Google **Gemini Flash** (`gemini-2.5-flash`), JSON output.
  - Same prompt (`prompt.ts`) feeds both, so results are comparable.
- `classify.ts` — picks a provider from config/env and classifies a batch.
- `summarize.ts` — rolls classified notes into a `SentimentSummary` (counts,
  net score, and an LLM-written one-paragraph narrative).
- `demo.ts` — run the whole thing for one BIP.

## Multi-provider

The engine is provider-agnostic. Choose at runtime:

```bash
SENTIMENT_PROVIDER=claude pnpm --filter @soft-fork-wiki/sentiment dev 110
SENTIMENT_PROVIDER=gemini pnpm --filter @soft-fork-wiki/sentiment dev 110
```

Because both providers implement the same interface and answer the same schema,
you can also run both and compare — handy for a hackathon demo ("Claude vs
Gemini Flash on what the network thinks about BIP 110").

- **Claude** needs `ANTHROPIC_API_KEY` (or `ant auth login`). Defaults to
  `claude-haiku-4-5` (fast/cheap for per-note classification); override with `CLAUDE_MODEL`.
- **Gemini** needs `GEMINI_API_KEY`. Defaults to `gemini-2.5-flash`
  (override with `GEMINI_MODEL`).

## Engagement — and why zap receipts are validated

`engagement.ts` pulls NIP-25 reactions, NIP-57 zap receipts and replies for a
set of note ids, which is what `rank.ts` orders by. Zaps are the vote, so a
forged receipt is a stuffed ballot, not a cosmetic problem.

**`zapTrust` defaults to `"lnurl"` and should stay there.** A receipt counts
only if its own signature verifies, the embedded kind:9734 validates, the `P`
tag matches the request author, and the receipt's author equals the
`nostrPubkey` that the recipient's own LNURL endpoint advertises. Recipients
that cannot be resolved are rejected rather than waved through — failing open
would reopen the hole, since an attacker would only need the endpoint to be
unreachable.

The exposure is not theoretical. Against the most-zapped live `#bip110` note
(20 genuine receipts, 22,912 sats), a single self-signed receipt with a
fabricated invoice scored:

| `zapTrust` | counted sats |
|---|---|
| `"none"` | 1,022,912 — the forger buys first place for free |
| `"structural"` | 1,022,912 — passes every offline check |
| `"lnurl"` (default) | 22,912, with `zapsRejected: 1` |

`"none"` and `"structural"` exist for offline fixtures only. Rejections are
reported per note (`zapsRejected`, `rejectedSats`) so an attack shows up
instead of quietly moving the board.

Other behaviour worth knowing: sats come from the `bolt11` invoice rather than
the requested `description` amount (measured ~63% disagreement on live data);
reactions dedupe per reactor so the count means *how many people*; `"-"`
reactions are excluded from `reactions` and reported as `downvotes`, since
counting them would let a critic promote the note they object to; and `lud06`
recipients are currently rejected because decoding bech32 needs a dependency
we do not have.
