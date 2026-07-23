/**
 * Year-by-year movement: how many BIPs were proposed, how they resolved, and
 * how many activations landed.
 *
 * Two different clocks are in play and mixing them is the classic error here.
 * `created` / `approved` / `rejected` are attributed to the year the BIP was
 * **proposed** — that is the cohort whose fate we are tracking. `activated` is
 * attributed to the year the activation **happened**. So a 2015 proposal that
 * went live in 2017 adds to 2015's `created` and 2017's `activated`; the two
 * series answer different questions and should be drawn on separate axes.
 */

import { yearOf } from "./dates.js";
import { safeRate } from "./stats.js";
import type { AnalyticsBip, ResolvedOptions, TrendPoint } from "./types.js";

interface YearBucket {
  created: number;
  approved: number;
  rejected: number;
  pending: number;
  activated: number;
}

function emptyBucket(): YearBucket {
  return { created: 0, approved: 0, rejected: 0, pending: 0, activated: 0 };
}

/**
 * Build the ascending, gap-filled yearly series.
 *
 * Years with no activity are emitted as zero rows rather than omitted: a
 * category axis that skips 2019 silently compresses a quiet stretch into
 * looking like continuous activity.
 *
 * BIPs with no parseable created date are excluded entirely — there is no
 * honest year to file them under. `InputQuality.missingCreatedDate` reports how
 * many that was.
 */
export function computeTrend(
  bips: readonly AnalyticsBip[],
  options: ResolvedOptions,
): TrendPoint[] {
  const buckets = new Map<number, YearBucket>();

  const bucketFor = (year: number): YearBucket => {
    const existing = buckets.get(year);
    if (existing) return existing;
    const created = emptyBucket();
    buckets.set(year, created);
    return created;
  };

  for (const bip of bips) {
    if (bip.createdAt) {
      const bucket = bucketFor(yearOf(bip.createdAt));
      bucket.created += 1;
      if (bip.outcome === "approved") bucket.approved += 1;
      else if (bip.outcome === "rejected") bucket.rejected += 1;
      else if (bip.outcome === "pending") bucket.pending += 1;
    }
    if (bip.activatedAt) {
      bucketFor(yearOf(bip.activatedAt)).activated += 1;
    }
  }

  if (buckets.size === 0) return [];

  const years = [...buckets.keys()].sort((a, b) => a - b);
  const firstYear = years[0];
  const lastYear = years[years.length - 1];

  const points: TrendPoint[] = [];
  let cumulativeCreated = 0;
  let cumulativeApproved = 0;

  for (let year = firstYear; year <= lastYear; year += 1) {
    const bucket = buckets.get(year) ?? emptyBucket();
    cumulativeCreated += bucket.created;
    cumulativeApproved += bucket.approved;
    const decided = bucket.approved + bucket.rejected;

    points.push({
      name: String(year),
      year,
      created: bucket.created,
      approved: bucket.approved,
      rejected: bucket.rejected,
      pending: bucket.pending,
      activated: bucket.activated,
      cumulativeCreated,
      cumulativeApproved,
      approvalRate: safeRate(bucket.approved, decided),
      // A single year is a tiny cohort almost everywhere in BIP history. The
      // cumulative series is the one to trust for a narrative; this flag exists
      // so the per-year rate line can be dashed or dimmed where it is noise.
      lowConfidence: decided < options.minGroupSize,
    });
  }

  return points;
}
