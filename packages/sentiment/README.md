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
