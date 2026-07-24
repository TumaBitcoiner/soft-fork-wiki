# Sentiment integration — what's on main & what's left

Handoff for the frontend. The sentiment slice is wired into the app and on
`main`. This is what it does, what changed, and the few things left on your end.

---

## TL;DR — to see it work

```bash
# 1. add one line to src/frontend/.env
VITE_SENTIMENT_BASE_URL=http://localhost:8002

# 2. start our sentiment service alongside the others
cd src/sentiment
set -a; . ./.env; set +a          # PowerShell: load .env manually, see below
PORT=8002 SENTIMENT_TTL_MS=86400000 npx pnpm@9 --filter @soft-fork-wiki/service dev

# 3. run the app as usual, open a BIP, click "Where People Stand"
```

PowerShell `.env` load:
```powershell
Get-Content .env | ForEach-Object { if ($_ -match '^\s*([^#=]+)=(.*)$') {
  [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim()) } }
$env:PORT = "8002"; npx pnpm@9 --filter "@soft-fork-wiki/service" dev
```

Open **BIP 300, 360, 141, or 119** — these are indexed *and* have real data, so
the gauge loads instantly.

---

## What it does

Each BIP's **"Where People Stand"** tab shows a live sentiment gauge:

- We pull public Nostr posts tagged `#bip<N>`, an LLM classifies each as
  good / not good / not sure, and the meter shows the net lean.
- Below it, a demo **"Zap your vote"** control (three stance boxes).

Real numbers, measured from live Nostr — e.g. BIP 300 reads **+24** from 183
posts (30% good / 51% not sure / 19% not good).

---

## Files changed (all on main)

| File | Change |
|------|--------|
| `src/frontend/src/api/httpProvider.ts` | `getSentiment` now calls the service (`/sentiment/:bip?mode=llm`) instead of throwing |
| `src/frontend/index.html` | **CSP**: added `:8002` to `connect-src` — without this the browser blocks the fetch |
| `src/frontend/.env.example` | added `VITE_SENTIMENT_BASE_URL` |
| `src/frontend/src/pages/BipPages.tsx` | the "Where People Stand" tab: live-sentiment header + demo zap-vote UI |
| `src/frontend/src/api/httpProvider.test.ts` | test now asserts the service call, not a throw |
| `src/sentiment/packages/service/*` | the service itself + `snapshot.json` (13 captured readings) |

Frontend gate is green: `tsc`, `eslint`, 11 tests, `vite build`.

---

## The service — how it answers

`GET /sentiment/:bip` returns exactly the `SentimentData` shape your
`api/types.ts` already declares, so nothing changed on the contract.

- **Default mode = zaps** (relay read, no LLM). We call `?mode=llm` from the
  frontend because that's the mode with a for/against **direction** to draw the
  meter — zap magnitude alone has no side.
- **Snapshot-first**: for the 13 BIPs we measured, it serves the captured
  reading **instantly** (no LLM call, no cold-start error). Other BIPs classify
  live (~30–90s cold, then cached). `?refresh=1` forces a live re-run.
- No API key needed for the 13 snapshot BIPs. Live classification of other
  BIPs needs `GEMINI_API_KEY` in `src/sentiment/.env`.

`/health` on `:8002` shows mode, cache stats, and confirms it's up.

---

## What's demo-only (your call to finish, not blocking the demo)

1. **The "Zap your vote" buttons don't publish yet.** They record a local
   choice and show a confirmation. Real publishing = a signed Nostr event,
   which needs the user's key in the browser. The builders exist in
   `@soft-fork-wiki/voting` (`buildOpinionEvent`, `buildZapRequest`) — they
   return *unsigned* templates; the frontend signs (NIP-07 / Nostrify) and
   publishes. Wiring that is the next real step.

2. **The gauge is post-sentiment only.** Zaps are NOT mixed into it — decided
   deliberately, so "what people say" (the gauge) stays separate from "what
   people pay for" (the money data, `satsScore` in the payload). Don't blend
   them; the divergence is the story (e.g. BIP 141: posts +64, money −42).

---

## Known limits

- **Only 9 of the 13 snapshot BIPs are clickable on the live site** — the
  backend indexes 50 BIPs and 158/340/352/444 aren't among them (404 on the
  detail page). They show in the standalone `src/sentiment/demo/gauge.html`.
  If you want 444's dramatic −99 money story live, it needs Tuma to index it.
- **Plain-language BIP explanation** needs the llm-backend on `:8001` +
  Tuma's ppq key. Without it the detail page shows raw BIP text only.
- **Empty state**: the top-nav "Where People Stand" *route* (`/sentiment`)
  still gates on `totalVotes === 0` and shows "No one has weighed in yet",
  because our gauge comes from posts (`sampleSize`), not in-app votes. If you
  want that route populated too, key it off `sampleSize` / `hasSignal`
  instead of `totalVotes`. The BIP-detail *tab* already renders correctly.

---

## Demo BIPs, ranked for the live site

| BIP | Gauge | Posts | Why |
|-----|-------|-------|-----|
| 300 Drivechains | +24 | 183 | genuinely contested, both camps in the data |
| 360 Quantum | +72 | 169 | strong, high volume |
| 141 SegWit | +77 | 122 | posts +77 but money −42 — the "talk vs money" hook |
| 119 CTV | +51 | 129 | divisive proposal, solid sample |

Warm them (open each once) before demoing so the cache is hot; the snapshot
ones are instant regardless.
