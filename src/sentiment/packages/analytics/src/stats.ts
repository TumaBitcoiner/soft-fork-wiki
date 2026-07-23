/**
 * Small, dependency-free descriptive statistics.
 *
 * Deliberately percentile-first. Time-to-activation for Bitcoin soft forks is a
 * handful of observations with a very long right tail (SegWit's activation
 * fight alone would drag a mean into fiction), so the median and the IQR are
 * the numbers worth showing. The mean is reported too, but only alongside the
 * spread that proves it is misleading.
 */

import { daysToYears } from "./dates.js";
import type { DistributionSummary, HistogramBin } from "./types.js";

/** Drop NaN/Infinity so one bad row cannot poison every statistic. */
function finiteOnly(values: readonly number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

/** Round to `digits` decimal places, avoiding `-0` and float noise in output. */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Linear-interpolated quantile over an already-sorted ascending array.
 *
 * Interpolating (rather than nearest-rank) matters at n=4: nearest-rank would
 * report the same observation for p25 and the median and make the distribution
 * look artificially tight.
 */
function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * Math.min(Math.max(q, 0), 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Quantile of an unsorted sample. `null` when there is nothing to measure. */
export function quantile(values: readonly number[], q: number): number | null {
  const sorted = finiteOnly(values).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return round(quantileSorted(sorted, q), 1);
}

/** Median of an unsorted sample. `null` when empty. */
export function median(values: readonly number[]): number | null {
  return quantile(values, 0.5);
}

/** Arithmetic mean. `null` when empty. */
export function mean(values: readonly number[]): number | null {
  const finite = finiteOnly(values);
  if (finite.length === 0) return null;
  const total = finite.reduce((sum, value) => sum + value, 0);
  return round(total / finite.length, 1);
}

/**
 * Full percentile summary.
 *
 * @returns `null` for an empty sample rather than a zero-filled object, so a
 *   caller cannot mistake "no data" for "everything activated instantly".
 */
export function summarizeDistribution(
  values: readonly number[],
): DistributionSummary | null {
  const sorted = finiteOnly(values).sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  const total = sorted.reduce((sum, value) => sum + value, 0);
  const average = total / sorted.length;
  // Population variance: we hold the whole sample, not a draw from a larger one.
  const variance =
    sorted.reduce((sum, value) => sum + (value - average) ** 2, 0) / sorted.length;

  const p25 = quantileSorted(sorted, 0.25);
  const p75 = quantileSorted(sorted, 0.75);

  return {
    n: sorted.length,
    min: round(sorted[0], 1),
    p25: round(p25, 1),
    median: round(quantileSorted(sorted, 0.5), 1),
    p75: round(p75, 1),
    p90: round(quantileSorted(sorted, 0.9), 1),
    max: round(sorted[sorted.length - 1], 1),
    mean: round(average, 1),
    iqr: round(p75 - p25, 1),
    stdDev: round(Math.sqrt(variance), 1),
  };
}

/** Trim a trailing `.0` so bin labels read "1–2y", not "1.0–2.0y". */
function formatYears(days: number): string {
  const years = daysToYears(days);
  return Number.isInteger(years) ? String(years) : years.toFixed(1);
}

/**
 * Bucket day-counts into fixed-width bins.
 *
 * Bins run from 0 to the highest observation, and empty interior bins are kept:
 * a gap in the middle of the distribution is information ("nothing activates
 * between years 2 and 4"), and dropping it would distort the X axis spacing.
 */
export function buildHistogram(
  values: readonly number[],
  binWidthDays: number,
): HistogramBin[] {
  const finite = finiteOnly(values).filter((value) => value >= 0);
  if (finite.length === 0) return [];

  const width = Math.max(1, Math.trunc(binWidthDays));
  // Reduce rather than `Math.max(...finite)`: spreading a large array can blow
  // the argument limit, and this code should not have a size cliff in it.
  const maxValue = finite.reduce((high, value) => (value > high ? value : high), 0);
  const binCount = Math.floor(maxValue / width) + 1;

  const bins: HistogramBin[] = [];
  for (let index = 0; index < binCount; index += 1) {
    const fromDays = index * width;
    const toDays = fromDays + width;
    bins.push({
      name: `${formatYears(fromDays)}–${formatYears(toDays)}y`,
      fromDays,
      toDays,
      count: 0,
    });
  }

  for (const value of finite) {
    // Clamp guards the exact-maximum case, which floors into binCount.
    const index = Math.min(Math.floor(value / width), binCount - 1);
    bins[index].count += 1;
  }

  return bins;
}

/**
 * Divide, returning `null` when the denominator is zero.
 *
 * A rate with no denominator is not 0 — it is unknown, and a chart should draw
 * a gap for it rather than a bar sitting on the floor.
 */
export function safeRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return round(numerator / denominator, 4);
}

/** Share of a total, where an empty total legitimately means 0. */
export function share(part: number, total: number): number {
  if (total <= 0) return 0;
  return round(part / total, 4);
}
