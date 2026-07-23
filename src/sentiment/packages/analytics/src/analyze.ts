/**
 * The one call most consumers want: records in, chart-ready `BipAnalytics` out.
 *
 * Pure and synchronous — no network, no clock unless you let it default, no
 * dependencies. That makes it safe to run in the browser on data the frontend
 * already fetched for its explorer view, rather than standing up another
 * endpoint to compute numbers we can derive client-side.
 */

import { computeActivationAnalytics } from "./activation.js";
import { groupStatsBy, statusMix, summarizeOutcomes } from "./groups.js";
import { normalizeBips } from "./normalize.js";
import { computeTrend } from "./trends.js";
import type { AnalyticsBip, AnalyticsOptions, BipAnalytics } from "./types.js";
import { resolveOptions } from "./types.js";

/**
 * Compute historical analytics over a set of BIP records.
 *
 * @param records Anything array-shaped, including `null`/`undefined` from a
 *   failed fetch. Records are validated per-row; the ones we cannot read are
 *   skipped and accounted for in `result.input`. Accepts both the Python API's
 *   snake_case rows and the frontend's `Bip` objects — see `BipInput` for the
 *   recognised keys.
 * @param options See `AnalyticsOptions`. Pass `generatedAt` for deterministic
 *   output, and `activationDateFor` if your activation dates live elsewhere.
 */
export function computeBipAnalytics(
  records: readonly unknown[] | null | undefined,
  options: AnalyticsOptions = {},
): BipAnalytics {
  const resolved = resolveOptions(options);
  const { bips, quality } = normalizeBips(records ?? [], resolved);

  return {
    generatedAt: resolved.generatedAt,
    input: quality,
    overall: summarizeOutcomes(bips),
    statusMix: statusMix(bips),
    byLayer: groupStatsBy(bips, (bip) => bip.layer, resolved),
    byType: groupStatsBy(bips, (bip) => bip.type, resolved),
    byEra: groupStatsBy(bips, (bip) => bip.era, resolved),
    byTopic: groupStatsBy(bips, (bip) => bip.topic, resolved),
    timeToActivation: computeActivationAnalytics(bips, resolved),
    trend: computeTrend(bips, resolved),
  };
}

/**
 * Normalise without aggregating.
 *
 * Exposed for consumers that want to slice the corpus their own way with
 * `groupStatsBy` — for example by author or by difficulty — without paying for
 * the full report or re-solving the snake_case/camelCase problem.
 */
export function normalizeBipRecords(
  records: readonly unknown[] | null | undefined,
  options: AnalyticsOptions = {},
): AnalyticsBip[] {
  return normalizeBips(records ?? [], resolveOptions(options)).bips;
}
