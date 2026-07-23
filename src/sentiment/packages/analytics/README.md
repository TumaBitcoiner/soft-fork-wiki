# @soft-fork-wiki/analytics — what actually happens to BIPs

Historical analytics over BIP records: which proposals get approved, how long
they take to activate, and how that varies by layer, type and era.

Pure, synchronous, dependency-free (only a **type-only** import from
`@soft-fork-wiki/shared`). No network, no keys, no clock unless you let it
default — so it runs in the browser on data the frontend already fetched, and
in Node next to the backend, with the same result.

## Use it

```ts
import { computeBipAnalytics } from "@soft-fork-wiki/analytics";

const records = await fetch("/bips/meta?limit=200").then((r) => r.json());
const analytics = computeBipAnalytics(records);

// Every series is a flat array of objects with a `name` key — feed straight to
// recharts as `data`, no reshaping:
// <BarChart data={analytics.byLayer}><Bar dataKey="approvalRate" /></BarChart>
```

Offline smoke test:

```bash
pnpm --filter @soft-fork-wiki/analytics dev
```

## What it computes

| Field | What it answers |
| --- | --- |
| `overall` | Approved / rejected / pending counts, approval rate, shipped share |
| `statusMix` | Share of each raw status value — a one-glance pie of the corpus |
| `byLayer`, `byType`, `byEra`, `byTopic` | The same breakdown sliced four ways, plus median time-to-activation per slice |
| `timeToActivation` | Percentile summary (min/p25/median/p75/p90/max, IQR, stdDev), a year-wide histogram, per-BIP scatter samples, fastest and slowest |
| `trend` | Per-year created / approved / rejected / pending / activated, cumulative totals, and the approval rate for each year's cohort |
| `input` | How many records we could read, how many we skipped and why |

Exported entry points:

- `computeBipAnalytics(records, options?)` → `BipAnalytics` — the one call you want.
- `normalizeBipRecords(records, options?)` → `AnalyticsBip[]` — normalise only.
- `groupStatsBy(bips, keyOf, options)` — slice by something we did not anticipate
  (author, difficulty, tag) without reimplementing the rate arithmetic.
- `parseBipDate`, `daysBetween`, `daysToYears`, `toIsoDate` — the date layer.
- `summarizeDistribution`, `median`, `quantile`, `buildHistogram`, `safeRate` — the stats layer.

## Input shapes

`computeBipAnalytics` takes `unknown[]`, on purpose: the input comes off an HTTP
response nobody has validated, and a narrower signature would just move the lie
upstream. It reads **both** producers in this repo without configuration:

- The Python API's SQLite rows — `bip_number`, `status`, `layer`, `type`,
  `authors` (one comma-joined string), `created`.
- The frontend's `Bip` — `number`, `status`, `layer`, `topic`, `era`,
  `authors: string[]`, `created`, `activated`.

See `BipInput` for the full alias list. Missing `topic` falls back to `type`;
missing `era` is derived from the created year (3-year windows anchored at 2011,
labelled `2012–2014` with the same en dash the frontend uses).

## Read these caveats before quoting a number

**1. Small samples make every rate noisy.** There are a few hundred BIPs in
total, and the soft-fork slice the backend serves is far smaller. Sliced by
layer *and* era you are routinely looking at n=2. Every `GroupStats` and
`TrendPoint` therefore carries `lowConfidence: boolean` (true when fewer than
`minGroupSize` proposals in that slice have actually resolved, default 5). Dim,
dash or annotate those in the UI — do not present "100% approval" off two
records as a finding.

**2. Approval rate is over *decided* proposals only.** `approvalRate` is
`approved / (approved + rejected)`. Drafts are excluded because a draft is not a
failure — most of the interesting covenant work is still open, and counting it
as rejection would make the current era look like a collapse. The other honest
reading, `approved / total`, is reported separately as `shippedShare`. They
answer different questions; pick one and label it.

**3. The backend pre-filters away the failures.** `src/backend` only ingests
`Status: Draft | Complete | Deployed`. Withdrawn, Rejected and Obsolete BIPs
never reach us, so against live API data `rejected` is **zero by construction**
and `approvalRate` is a *completion* rate among survivors, not a measure of how
often the process says no. Attrition analysis needs an unfiltered corpus.

**4. The backend has no activation dates.** The `bips` table has `created` and
nothing else temporal, so time-to-activation is empty against live API data
unless you supply `activationDateFor`, a callback that resolves an activation
date per BIP from your own history. `timeToActivation.missingActivationDate`
counts approved BIPs with no date, so the gap is visible rather than implied.
Activation dates are historical facts and belong in the data layer, not baked
into a stats library.

**5. Medians, not means.** Time-to-activation has a brutal right tail — one
contested activation drags a mean into fiction. `DistributionSummary` reports
the mean, but always next to the IQR and stdDev that show why you should not
lead with it.

**6. Partial dates are anchored early.** `2015` parses as 2015-01-01 and
`2015-11` as 2015-11-01. That biases intervals slightly long, which is the
conservative direction for a "how slow is this process" number. Unparseable
dates return `null` rather than a guess — we do not hand strings to `new Date`,
because V8 reads `"sometime in 2019"` as 2019-01-01 and another engine would not.

**7. Two clocks in `trend`.** `created`/`approved`/`rejected` are attributed to
the year a BIP was *proposed* (the cohort whose fate we track); `activated` is
attributed to the year activation *happened*. A 2015 proposal that went live in
2017 appears in both. Do not draw them as one series.

**8. Nothing throws.** A record we cannot identify is skipped and counted in
`input.skipReasons` (with example ids); a record with one broken field keeps the
fields that parsed. `input.analyzed` versus `input.total` tells you how much of
the corpus a given number is actually about.

## Layout

```
src/types.ts       result + option types, status vocabularies, defaults
src/dates.ts       tolerant BIP header date parsing (UTC, never throws)
src/stats.ts       percentiles, histogram, safe rates
src/normalize.ts   unknown[] -> AnalyticsBip[], with skip accounting
src/groups.ts      outcome tallies, whole-corpus and grouped
src/activation.ts  time from created -> activated
src/trends.ts      gap-filled per-year series
src/analyze.ts     computeBipAnalytics — the orchestrator
src/demo.ts        offline smoke test
```
