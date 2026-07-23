/**
 * How long approved BIPs took to go from "proposed" to "live".
 *
 * This is the headline number of the package and also the most fragile one, so
 * it reports its own blind spot: `missingActivationDate` counts BIPs that are
 * approved but carry no activation date, which against the current Python API
 * is *all of them* (the `bips` table has `created` and no activation column).
 * A consumer that shows a median without showing that denominator is lying by
 * omission — hence both are on the result object.
 */

import { daysBetween, daysToYears, toIsoDate, yearOf } from "./dates.js";
import { buildHistogram, summarizeDistribution } from "./stats.js";
import type {
  ActivationAnalytics,
  ActivationSample,
  AnalyticsBip,
  ResolvedOptions,
} from "./types.js";

/** Build the plottable record for one BIP that made it all the way through. */
function toSample(bip: AnalyticsBip, createdAt: Date, activatedAt: Date): ActivationSample {
  const days = daysBetween(createdAt, activatedAt);
  return {
    number: bip.number,
    title: bip.title,
    layer: bip.layer,
    type: bip.type,
    era: bip.era,
    createdAt: toIsoDate(createdAt),
    activatedAt: toIsoDate(activatedAt),
    days,
    years: daysToYears(days),
    activatedYear: yearOf(activatedAt),
  };
}

/**
 * Compute the time-to-activation section.
 *
 * Any BIP with both dates contributes, regardless of its current status: a BIP
 * that activated and was later marked Replaced still took exactly as long as it
 * took, and dropping it would bias the sample toward whatever is live today.
 */
export function computeActivationAnalytics(
  bips: readonly AnalyticsBip[],
  options: ResolvedOptions,
): ActivationAnalytics {
  const samples: ActivationSample[] = [];
  let inconsistentDates = 0;
  let missingActivationDate = 0;

  for (const bip of bips) {
    if (!bip.activatedAt) {
      if (bip.outcome === "approved") missingActivationDate += 1;
      continue;
    }
    if (!bip.createdAt) {
      // We know when it landed but not when it started, so the interval is
      // unknowable. Counted as a gap rather than silently dropped.
      missingActivationDate += 1;
      continue;
    }
    if (daysBetween(bip.createdAt, bip.activatedAt) < 0) {
      inconsistentDates += 1;
      continue;
    }
    samples.push(toSample(bip, bip.createdAt, bip.activatedAt));
  }

  samples.sort((a, b) => a.activatedAt.localeCompare(b.activatedAt) || a.number - b.number);

  const days = samples.map((sample) => sample.days);
  // Sorted by duration, not by date, so "fastest"/"slowest" mean what they say.
  const byDuration = [...samples].sort((a, b) => a.days - b.days);

  return {
    sampleSize: samples.length,
    missingActivationDate,
    inconsistentDates,
    days: summarizeDistribution(days),
    histogram: buildHistogram(days, options.activationBinDays),
    samples,
    fastest: byDuration.length > 0 ? byDuration[0] : null,
    slowest: byDuration.length > 0 ? byDuration[byDuration.length - 1] : null,
  };
}
