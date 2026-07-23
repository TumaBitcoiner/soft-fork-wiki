/**
 * Outcome tallies, whole-corpus and sliced by category.
 *
 * The central editorial decision lives here: **approval rate is measured over
 * decided proposals only** (`approved / (approved + rejected)`). Drafts are not
 * failures — most of the interesting covenant proposals are still open — and
 * counting them as such would make every recent era look like a collapse.
 * `shippedShare` is reported alongside for the other, equally fair reading:
 * of everything ever proposed here, how much actually shipped.
 */

import { daysBetween } from "./dates.js";
import { median, safeRate, share } from "./stats.js";
import type {
  AnalyticsBip,
  CategoryCount,
  GroupStats,
  OutcomeBreakdown,
  ResolvedOptions,
} from "./types.js";

/** Count outcomes across a set of BIPs and derive the two headline rates. */
export function summarizeOutcomes(bips: readonly AnalyticsBip[]): OutcomeBreakdown {
  let approved = 0;
  let rejected = 0;
  let pending = 0;
  let unknown = 0;

  for (const bip of bips) {
    if (bip.outcome === "approved") approved += 1;
    else if (bip.outcome === "rejected") rejected += 1;
    else if (bip.outcome === "pending") pending += 1;
    else unknown += 1;
  }

  const total = bips.length;
  const decided = approved + rejected;

  return {
    total,
    approved,
    rejected,
    pending,
    unknown,
    decided,
    approvalRate: safeRate(approved, decided),
    shippedShare: share(approved, total),
    attritionShare: share(rejected, total),
  };
}

/** Days from creation to activation, for BIPs where both dates are sane. */
function activationDays(bips: readonly AnalyticsBip[]): number[] {
  const days: number[] = [];
  for (const bip of bips) {
    if (!bip.createdAt || !bip.activatedAt) continue;
    const delta = daysBetween(bip.createdAt, bip.activatedAt);
    // Negative means the record claims activation before proposal. That is bad
    // data, not a fast approval, so it is excluded rather than clamped to 0.
    if (delta >= 0) days.push(delta);
  }
  return days;
}

/**
 * Group BIPs by an arbitrary key and compute stats per group.
 *
 * Exported so consumers can slice by something we did not anticipate (author,
 * difficulty, tag) without reimplementing the rate arithmetic and the
 * small-sample flagging.
 *
 * Sorted by size descending: the biggest bar first reads correctly left to
 * right and keeps the noisy singleton groups out of the eye's landing zone.
 */
export function groupStatsBy(
  bips: readonly AnalyticsBip[],
  keyOf: (bip: AnalyticsBip) => string,
  options: ResolvedOptions,
): GroupStats[] {
  const groups = new Map<string, AnalyticsBip[]>();
  for (const bip of bips) {
    const key = keyOf(bip).trim() || "Unspecified";
    const bucket = groups.get(key);
    if (bucket) bucket.push(bip);
    else groups.set(key, [bip]);
  }

  const stats: GroupStats[] = [];
  for (const [name, members] of groups) {
    const days = activationDays(members);
    const breakdown = summarizeOutcomes(members);
    stats.push({
      name,
      ...breakdown,
      medianDaysToActivation: median(days),
      activatedSampleSize: days.length,
      // Flagged on `decided`, not `total`: a group of 30 drafts still supports
      // no claim about approval, because none of them have resolved.
      lowConfidence: breakdown.decided < options.minGroupSize,
    });
  }

  return stats.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** Raw status mix — a one-glance pie of what the corpus is made of. */
export function statusMix(bips: readonly AnalyticsBip[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const bip of bips) {
    counts.set(bip.status, (counts.get(bip.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, share: share(count, bips.length) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
