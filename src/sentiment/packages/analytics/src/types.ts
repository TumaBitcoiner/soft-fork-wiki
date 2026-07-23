/**
 * Types for historical BIP analytics.
 *
 * Everything a consumer sees is deliberately flat and chart-ready: the frontend
 * draws with `recharts`, which wants an array of plain objects plus a `dataKey`.
 * So every series here is an array whose members carry a `name` string (the
 * category / X value) alongside bare numbers — no nested lookups, no Maps, no
 * Dates. Dates are emitted as ISO `YYYY-MM-DD` strings for the same reason:
 * they survive JSON transport to the browser unchanged.
 */

import type { BipStatus } from "@soft-fork-wiki/shared";

/**
 * The statuses we actually see in the wild.
 *
 * `BipStatus` in shared is the BIP-2 vocabulary, but the Python API serves
 * `Draft | Complete | Deployed` and the frontend also models `Closed`. Rather
 * than pick a winner (that is docs/AGENTS.md open item #3, not ours to settle)
 * we accept the union and classify case-insensitively.
 */
export type AnalyticsBipStatus = BipStatus | "Complete" | "Deployed" | "Closed";

/**
 * What ultimately happened to a proposal.
 *
 * `pending` is genuinely different from `rejected` — lumping drafts in with
 * withdrawals would make every era with active research look like a failure.
 * `unknown` keeps unrecognised statuses out of the rate denominators instead of
 * silently scoring them.
 */
export type BipOutcome = "approved" | "rejected" | "pending" | "unknown";

/** Statuses that mean "this shipped / reached its final approved state". */
export const APPROVED_STATUSES: readonly AnalyticsBipStatus[] = [
  "Active",
  "Final",
  "Deployed",
  "Complete",
];

/** Statuses that mean "this will not ship in this form". */
export const REJECTED_STATUSES: readonly AnalyticsBipStatus[] = [
  "Rejected",
  "Withdrawn",
  "Obsolete",
  "Replaced",
  "Closed",
];

/** Statuses that mean "still in flight". */
export const PENDING_STATUSES: readonly AnalyticsBipStatus[] = [
  "Draft",
  "Proposed",
  "Deferred",
];

/**
 * The record shape we know how to read.
 *
 * Both spellings are accepted because two producers exist: the Python API
 * (`bip_number`, `type`, `created`) and the frontend's `Bip` (`number`,
 * `topic`, `era`, `activated`). Nothing is required — the analyzer takes
 * `unknown[]` and validates, so a malformed record costs you one skipped row
 * rather than a thrown exception.
 */
export interface BipInput {
  number?: number | string;
  bip_number?: number | string;
  bipNumber?: number | string;
  title?: string;
  status?: string;
  layer?: string;
  /** BIP-2 type ("Standards Track", "Informational", "Process"). */
  type?: string;
  /** Frontend's editorial grouping ("Script", "Covenants", ...). */
  topic?: string;
  /** Frontend's era label, e.g. "2015–2017". Derived from `created` when absent. */
  era?: string;
  authors?: readonly string[] | string;
  created?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  activated?: string | null;
  activated_at?: string | null;
  activatedAt?: string | null;
}

/** A record after normalisation — the internal currency of this package. */
export interface AnalyticsBip {
  number: number;
  title: string;
  /** Raw status string as received. Compare against `AnalyticsBipStatus`. */
  status: string;
  outcome: BipOutcome;
  layer: string;
  type: string;
  topic: string;
  era: string;
  authors: string[];
  /** `null` when the record had no parseable `Created:` header. */
  createdAt: Date | null;
  /** `null` when unknown — the Python API does not carry activation dates. */
  activatedAt: Date | null;
}

/** Why a record was dropped, with a few example BIP ids for debugging. */
export interface SkipReason {
  reason:
    | "not-an-object"
    | "missing-bip-number"
    | "missing-status"
    | "duplicate-bip-number"
    | "threw-while-reading";
  count: number;
  /** Up to `maxSkipExamples` identifiers, for eyeballing what went wrong. */
  examples: string[];
}

/**
 * How much of the input survived.
 *
 * Surfaced rather than logged: an approval rate computed over 40% of the corpus
 * is a different claim than one computed over all of it, and the UI should be
 * able to say so.
 */
export interface InputQuality {
  total: number;
  analyzed: number;
  skipped: number;
  skipReasons: SkipReason[];
  /** Analyzed records with no parseable created date (excluded from trends). */
  missingCreatedDate: number;
  /** Analyzed records whose status we could not classify. */
  unknownStatuses: CategoryCount[];
}

/** A plain category count, shaped for a pie/bar chart. */
export interface CategoryCount {
  name: string;
  count: number;
  /** 0..1 fraction of the analyzed set. */
  share: number;
}

/** Outcome counts plus the two rates worth quoting. */
export interface OutcomeBreakdown {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  unknown: number;
  /** approved + rejected — the only records that have actually resolved. */
  decided: number;
  /**
   * approved / decided, or `null` when nothing has resolved.
   * `null` rather than 0 so a chart draws a gap instead of a false floor.
   */
  approvalRate: number | null;
  /** approved / total — the share of everything proposed that shipped. */
  shippedShare: number;
  /** rejected / total — attrition, the mirror of `shippedShare`. */
  attritionShare: number;
}

/** One bar/slice of a grouped comparison (by layer, type, era, topic...). */
export interface GroupStats extends OutcomeBreakdown {
  /** Category label. Named `name` so recharts can use it as the axis dataKey. */
  name: string;
  /** Median days from created -> activated within this group. */
  medianDaysToActivation: number | null;
  /** How many BIPs in this group had both dates. */
  activatedSampleSize: number;
  /**
   * True when `decided` is under the confidence threshold. Bitcoin has a few
   * hundred BIPs total, so most slices are tiny — render these greyed out or
   * annotated rather than presenting a 100% rate off n=2.
   */
  lowConfidence: boolean;
}

/** Percentile summary of a numeric sample. */
export interface DistributionSummary {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
  mean: number;
  /** p75 - p25. The honest spread number for a skewed, small sample. */
  iqr: number;
  stdDev: number;
}

/** One bucket of the time-to-activation histogram. */
export interface HistogramBin {
  /** Human label, e.g. "1–2y". Use as the recharts X dataKey. */
  name: string;
  fromDays: number;
  toDays: number;
  count: number;
}

/** One BIP's journey from proposal to activation — plottable as a scatter point. */
export interface ActivationSample {
  number: number;
  title: string;
  layer: string;
  type: string;
  era: string;
  /** ISO `YYYY-MM-DD`. */
  createdAt: string;
  /** ISO `YYYY-MM-DD`. */
  activatedAt: string;
  days: number;
  /** `days` expressed in years (365.25 days), rounded to 2dp. */
  years: number;
  /** Calendar year of activation — handy as a scatter X axis. */
  activatedYear: number;
}

/** How long approved BIPs took to actually activate. */
export interface ActivationAnalytics {
  sampleSize: number;
  /** Approved BIPs with no usable activation date — the blind spot. */
  missingActivationDate: number;
  /** Records where activation preceded creation; excluded as bad data. */
  inconsistentDates: number;
  /** `null` when nothing in the input had both dates. */
  days: DistributionSummary | null;
  histogram: HistogramBin[];
  /** Sorted oldest-activation first. */
  samples: ActivationSample[];
  fastest: ActivationSample | null;
  slowest: ActivationSample | null;
}

/** One year of the trend series. Years with no activity are present as zeros. */
export interface TrendPoint {
  /** Year as a string, so recharts can use it directly as a category axis. */
  name: string;
  year: number;
  created: number;
  approved: number;
  rejected: number;
  pending: number;
  /** BIPs that *activated* in this year (by activation date, not creation). */
  activated: number;
  cumulativeCreated: number;
  cumulativeApproved: number;
  /** approved / (approved + rejected) among BIPs *created* this year. */
  approvalRate: number | null;
  lowConfidence: boolean;
}

/** The whole result. Serialises to JSON cleanly; safe to hand to the frontend. */
export interface BipAnalytics {
  /** Unix seconds. Caller-supplied when determinism matters (tests, demos). */
  generatedAt: number;
  input: InputQuality;
  overall: OutcomeBreakdown;
  /** Share of each raw status value — a one-glance pie of the corpus. */
  statusMix: CategoryCount[];
  byLayer: GroupStats[];
  byType: GroupStats[];
  byEra: GroupStats[];
  byTopic: GroupStats[];
  timeToActivation: ActivationAnalytics;
  /** Ascending by year, gap-filled. */
  trend: TrendPoint[];
}

/** Tuning knobs. Every field has a defensible default; all are optional. */
export interface AnalyticsOptions {
  /** Unix seconds stamp for the result. Defaults to now. */
  generatedAt?: number;
  /**
   * Supply an activation date the record itself lacks.
   *
   * The Python API stores no activation date at all, so without this hook the
   * time-to-activation section is empty against live backend data. Kept as a
   * callback rather than a baked-in table because activation dates are historical
   * facts that belong in the data layer, not in a stats library.
   */
  activationDateFor?: (bip: AnalyticsBip) => string | Date | null | undefined;
  /** Override the approved/rejected/pending status vocabularies. */
  approvedStatuses?: readonly string[];
  rejectedStatuses?: readonly string[];
  pendingStatuses?: readonly string[];
  /** Groups with fewer decided BIPs than this are flagged. Default 5. */
  minGroupSize?: number;
  /** Width of a derived era bucket, in years. Default 3. */
  eraWindowYears?: number;
  /** First year of the first derived era bucket. Default 2011 (BIP-1). */
  eraEpochYear?: number;
  /** Histogram bin width for time-to-activation, in days. Default 365. */
  activationBinDays?: number;
  /** Example ids retained per skip reason. Default 5. */
  maxSkipExamples?: number;
}

/** `AnalyticsOptions` with every default filled in. */
export interface ResolvedOptions {
  generatedAt: number;
  activationDateFor: ((bip: AnalyticsBip) => string | Date | null | undefined) | null;
  approvedStatuses: readonly string[];
  rejectedStatuses: readonly string[];
  pendingStatuses: readonly string[];
  minGroupSize: number;
  eraWindowYears: number;
  eraEpochYear: number;
  activationBinDays: number;
  maxSkipExamples: number;
}

/** Label used wherever a record has no value for the grouping field. */
export const UNSPECIFIED = "Unspecified";

/** Label used for records whose created date could not be parsed. */
export const UNKNOWN_ERA = "Unknown era";

/** Fill in defaults once, up front, so no downstream code re-derives them. */
export function resolveOptions(options: AnalyticsOptions = {}): ResolvedOptions {
  return {
    generatedAt: options.generatedAt ?? Math.floor(Date.now() / 1000),
    activationDateFor: options.activationDateFor ?? null,
    approvedStatuses: options.approvedStatuses ?? APPROVED_STATUSES,
    rejectedStatuses: options.rejectedStatuses ?? REJECTED_STATUSES,
    pendingStatuses: options.pendingStatuses ?? PENDING_STATUSES,
    minGroupSize: options.minGroupSize ?? 5,
    eraWindowYears: Math.max(1, Math.trunc(options.eraWindowYears ?? 3)),
    eraEpochYear: Math.trunc(options.eraEpochYear ?? 2011),
    activationBinDays: Math.max(1, Math.trunc(options.activationBinDays ?? 365)),
    maxSkipExamples: Math.max(0, Math.trunc(options.maxSkipExamples ?? 5)),
  };
}
