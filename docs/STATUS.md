# Status — sentiment / voting / analytics

Everything below is on `main` under `src/sentiment/`, a self-contained
workspace with its own `package.json` and lockfile so it cannot collide with
the frontend's npm project or the Python backends. Nothing of ours sits at the
repo root.

## It works — here is real output, not a feature list

Live runs against public Nostr notes, classified by LLM:

| BIP | notes | 👍 good | 👎 not good | 🤔 not sure | gauge |
|-----|------:|--------:|------------:|------------:|------:|
| 444 — datacarrier | 4 | 0 | 2 | 2 | **−100** |
| 300 — Drivechains | 100 | 35 | 22 | 43 | **+23** |
| 110 | 118 | 63 | 24 | 31 | **+45** |
| 360 — quantum | 10 | 5 | 1 | 4 | **+71** |
| 119 — CTV | 9 | 3 | 0 | 6 | **+100** |

**BIP 300 is the one to demo.** Real split, and both camps argue in the
narrative the model writes: supporters call it "a lightweight and opt-in
upgrade", opponents "a trojan horse threatening Bitcoin's integrity". That is
the whole product in one screen — both sides, no side taken.

## What exists

**Sentiment engine.** Pulls public notes tagged `#bip<N>`, classifies each as
good / not good / not sure, aggregates to a score and a written summary.
Gemini Flash by default, Claude also supported.

**HTTP service** — `GET /sentiment/:bip` on port `8002`. Returns exactly the
`SentimentData` shape the frontend already declares in `src/api/types.ts` and
currently serves from the mock. Filling those two functions in *is* the
integration. Per-BIP cache; repeat calls return in ~3ms.

**Voting primitives** — NIP-88 poll (the vote), NIP-57 zap request builder,
plain opinion notes, tallying. Every builder returns an **unsigned** event: the
frontend signs with the user's key, so no key ever reaches a server.

**Engagement + ranking** — reads reactions and zap receipts off the relays and
ranks posts by zapped sats. Receipts are validated against the recipient's own
LNURL endpoint. That is not paranoia: a forged receipt we tested counted as
**1,022,912 sats** unvalidated — anyone could buy the top slot for free — and
is correctly rejected with validation on.

**BIP analytics** — approval rates by layer / type / era, year-over-year trend,
and time-to-activation. Activation dates are sourced from Bitcoin Core's own
consensus parameters. Median soft fork takes ~350 days from proposal to
activation; fastest 89 (P2SH), slowest 665 (Taproot).

## In progress

LNURL invoice flow, so the zap loop can be exercised from Node without waiting
on frontend work.

## Missing from our side

One thing: **a Nostr account with a Lightning address (`lud16`) in its
profile**, so votes have somewhere to pay. Needs a human with a wallet —
Coinos, Wallet of Satoshi and Alby all work. That is the only blocker we own.

## Needed from the frontend

1. **Install the NWC skill.** Already in the repo at `.agents/skills/nwc/` but
   explicitly *not* installed by default — copy 8 files into `src/` and
   `npm install @getalby/sdk @webbtc/webln-types`. It provides the entire
   payment loop: wallet connect, WebLN, LNURL invoice, QR fallback,
   `ZapButton` / `ZapDialog`.

2. **Build zap requests with our `buildZapRequest`, not the stock
   `nip57.makeZapRequest`.** ⚠️ This one fails silently. The stock helper omits
   the `#bip<N>`, app and stance tags, so the zap succeeds, the money moves,
   and our tally sees nothing at all. Nothing errors.

3. **Split the empty state.** `BipPages.tsx` gates the whole sentiment panel on
   `totalVotes === 0`. BIP 110 has 118 analysed posts and a real +45 reading
   that the screen currently hides because nobody has voted in-app yet. "Where
   people stand" should render on `sampleSize > 0`; keep "No one's weighed in
   yet" for the vote section only.

4. **Point `/sentiment` at the service.** One `VITE_API_BASE_URL` is shared
   with `/bips`, so it cannot serve both — a Vite dev proxy for `/sentiment` →
   `localhost:8002` is the clean fix.

5. **Copy.** Show 👍 Good for Bitcoin / 👎 Not good / 🤔 Not sure yet under a
   **"Where people stand"** header. Never the raw words favour / against /
   neutral, and never "67% in favour" — the score is a net lean, not a share of
   people. Full rules in [`src/sentiment/docs/AGENTS.md`](../src/sentiment/docs/AGENTS.md).

## Needed from the backend

Nothing blocking. Activation dates are solved on our side.

Optional: `ingest.py` filters to `Draft|Complete|Deployed`, so rejected BIPs
never reach the DB — which means "approval rate" is really a completion rate
among survivors. Ingesting rejected ones and filtering at the API layer instead
would give the analytics honest denominators.

## Known limits — say these before a judge finds them

- **We are only seeing a slice of Nostr, and it is the wrong slice.** We query
  `kind:1` notes carrying the `#bip<N>` tag. Measured coverage against keyword
  search on a NIP-50 relay:

  | BIP | via hashtag | via keyword | **new** from keyword |
  |-----|------------:|------------:|---------------------:|
  | 300 | 113 | 66 | **66** — no overlap at all |
  | 119 | 9 | 6 | 5 |
  | 444 | 4 | 29 | **29** — 7× more |

  Two almost disjoint populations: people who *tag* a post are broadcasting;
  people *arguing* about a proposal rarely type the hashtag. On top of that,
  **124 long-form articles (`kind:30023`)** exist for these topics and we never
  query that kind — long-form is where substantive analysis lives. And
  `relay.nostr.band`, one of our four default relays, currently returns 0 for
  every query including plain tag lookups, so we are effectively on three.

  This is why BIP 444 reads −100 off 4 notes when ~33 exist. Fixing coverage
  matters more than adding non-Nostr sources.

- **The `#bip<N>` hashtag also catches general Bitcoin posts**, not only
  discussion of the proposal. A real BIP 110 note read *"Bitcoin breaks the
  centralizing slavery chains… #BIP110"* — classified in favour, argues nothing
  about the BIP. So the gauge measures **tagged sentiment, not informed
  technical review**. "We read the posts and counted them up" is honest; "the
  community has reviewed this" is not.

- **Small samples make the gauge extreme.** BIP 119 reads +100 off 3
  side-taking notes; BIP 444 reads −100 off 2. Suppress or caveat the gauge
  below roughly 5 side-takers.

- **Ranking scraped notes by zaps surfaces popular accounts, not good
  arguments** — because the notes often are not about the BIP. Market ranking
  belongs on point-of-view posts written *in* the app. Suggested split: gauge
  from scraped notes, "best points of view" from in-app posts only.

- **First call for a busy BIP takes 1–3 minutes** (one LLM call per note).
  Warm the cache on the BIPs being demoed *before* going on stage.

## How to run it

```bash
cd src/sentiment
set -a; . ./.env; set +a          # needs GEMINI_API_KEY
npx pnpm@9 --filter @soft-fork-wiki/service dev
curl http://127.0.0.1:8002/sentiment/300
```

`/health` works with no key. Try 360 (10 notes, quick) before 110 (118 notes,
slow on first call).
