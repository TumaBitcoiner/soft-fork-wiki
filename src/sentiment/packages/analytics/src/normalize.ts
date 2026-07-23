/**
 * Turn whatever the callers hand us into `AnalyticsBip` records.
 *
 * Two producers exist and they disagree: the Python API serves snake_case rows
 * straight out of SQLite (`bip_number`, `type`, `authors` as one comma-joined
 * string, no activation date at all), while the frontend's `Bip` is camelCase
 * with `topic`, `era` and an optional `activated`. Rather than force a contract
 * neither side has agreed to yet (docs/AGENTS.md open item #3), we read both and
 * normalise here — one messy function instead of a messy assumption everywhere.
 *
 * Nothing in this file throws. A record we cannot identify is dropped and
 * counted; a record with one broken field keeps the fields that did parse.
 */

import { parseBipDate } from "./dates.js";
import type {
  AnalyticsBip,
  BipOutcome,
  InputQuality,
  CategoryCount,
  ResolvedOptions,
  SkipReason,
} from "./types.js";
import { UNKNOWN_ERA, UNSPECIFIED } from "./types.js";
import { share } from "./stats.js";

/** Aliases per logical field, in priority order. */
const NUMBER_KEYS = ["number", "bip_number", "bipNumber", "bip"] as const;
const TITLE_KEYS = ["title", "name"] as const;
const STATUS_KEYS = ["status"] as const;
const LAYER_KEYS = ["layer"] as const;
const TYPE_KEYS = ["type", "bip_type", "bipType"] as const;
const TOPIC_KEYS = ["topic", "category"] as const;
const ERA_KEYS = ["era"] as const;
const AUTHOR_KEYS = ["authors", "author"] as const;
const CREATED_KEYS = ["created", "created_at", "createdAt"] as const;
const ACTIVATED_KEYS = [
  "activated",
  "activated_at",
  "activatedAt",
  "activation_date",
  "activationDate",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** Accept `110` and `"110"` alike — SQLite drivers and JSON both show up. */
function readNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === "string") {
      const text = value.trim();
      if (/^\d+$/.test(text)) return Number(text);
    }
  }
  return null;
}

function readDate(record: Record<string, unknown>, keys: readonly string[]): Date | null {
  for (const key of keys) {
    const parsed = parseBipDate(record[key]);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Split the BIP header author line into names.
 *
 * The header format is `Author: Name <email>` repeated, so we strip the angle
 * brackets: an email address is not a person's name and would fragment any
 * per-author grouping a consumer builds on top of this.
 */
function readAuthors(record: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      const names = value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.replace(/<[^>]*>/g, "").trim())
        .filter((entry) => entry.length > 0);
      if (names.length > 0) return names;
    }
    if (typeof value === "string" && value.trim()) {
      const names = value
        .split(/[,\n]/)
        .map((entry) => entry.replace(/<[^>]*>/g, "").trim())
        .filter((entry) => entry.length > 0);
      if (names.length > 0) return names;
    }
  }
  return [];
}

/**
 * Bucket a creation year into a fixed-width era window.
 *
 * Only used when the record carries no `era` of its own. Anchored at 2011 (the
 * year BIP-1 was written) so the buckets line up with the history rather than
 * with an arbitrary decade boundary. En dash to match the frontend's existing
 * era labels ("2015–2017").
 */
export function deriveEra(createdAt: Date | null, options: ResolvedOptions): string {
  if (!createdAt) return UNKNOWN_ERA;
  const year = createdAt.getUTCFullYear();
  const span = options.eraWindowYears;
  const start = options.eraEpochYear + Math.floor((year - options.eraEpochYear) / span) * span;
  if (span === 1) return String(start);
  return `${start}–${start + span - 1}`;
}

/** Case- and whitespace-insensitive membership test for status vocabularies. */
function matchesStatus(status: string, vocabulary: readonly string[]): boolean {
  const needle = status.trim().toLowerCase();
  return vocabulary.some((entry) => entry.trim().toLowerCase() === needle);
}

/**
 * Map a raw status string onto an outcome.
 *
 * Unrecognised statuses become `"unknown"` rather than being folded into
 * `pending`: they stay out of the rate denominators, so a vocabulary drift on
 * the backend shows up as a visible unknown count instead of a quietly wrong
 * approval rate.
 */
export function classifyOutcome(status: string, options: ResolvedOptions): BipOutcome {
  if (!status.trim()) return "unknown";
  if (matchesStatus(status, options.approvedStatuses)) return "approved";
  if (matchesStatus(status, options.rejectedStatuses)) return "rejected";
  if (matchesStatus(status, options.pendingStatuses)) return "pending";
  return "unknown";
}

/** Result of normalising a batch: the good rows plus an audit of the bad ones. */
export interface NormalizeResult {
  bips: AnalyticsBip[];
  quality: InputQuality;
}

/**
 * Normalise a batch of unknown records.
 *
 * Takes `unknown[]` on purpose. The input arrives from an HTTP response that
 * nobody has validated, and a signature promising otherwise would just move the
 * lie upstream.
 */
export function normalizeBips(
  records: readonly unknown[],
  options: ResolvedOptions,
): NormalizeResult {
  const bips: AnalyticsBip[] = [];
  const seen = new Set<number>();
  const skips = new Map<SkipReason["reason"], SkipReason>();
  const unknownStatusCounts = new Map<string, number>();
  let missingCreatedDate = 0;

  const noteSkip = (reason: SkipReason["reason"], example: string): void => {
    const entry = skips.get(reason) ?? { reason, count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < options.maxSkipExamples) entry.examples.push(example);
    skips.set(reason, entry);
  };

  records.forEach((raw, index) => {
    try {
      if (!isRecord(raw)) {
        noteSkip("not-an-object", `index ${index}`);
        return;
      }

      const number = readNumber(raw, NUMBER_KEYS);
      if (number === null) {
        noteSkip("missing-bip-number", `index ${index}`);
        return;
      }
      if (seen.has(number)) {
        // First occurrence wins. The API returns BIPs ordered by number, so a
        // repeat is a pagination overlap, not a correction.
        noteSkip("duplicate-bip-number", `BIP ${number}`);
        return;
      }

      const status = readString(raw, STATUS_KEYS);
      if (!status) {
        noteSkip("missing-status", `BIP ${number}`);
        return;
      }

      seen.add(number);

      const createdAt = readDate(raw, CREATED_KEYS);
      if (!createdAt) missingCreatedDate += 1;

      const outcome = classifyOutcome(status, options);
      if (outcome === "unknown") {
        unknownStatusCounts.set(status, (unknownStatusCounts.get(status) ?? 0) + 1);
      }

      const type = readString(raw, TYPE_KEYS);
      const topic = readString(raw, TOPIC_KEYS);
      const era = readString(raw, ERA_KEYS);

      const bip: AnalyticsBip = {
        number,
        title: readString(raw, TITLE_KEYS) || `BIP ${number}`,
        status,
        outcome,
        layer: readString(raw, LAYER_KEYS) || UNSPECIFIED,
        type: type || UNSPECIFIED,
        // The API has `type` but no `topic`; the frontend has both. Falling back
        // keeps the topic chart populated against either producer.
        topic: topic || type || UNSPECIFIED,
        era: era || deriveEra(createdAt, options),
        authors: readAuthors(raw, AUTHOR_KEYS),
        createdAt,
        activatedAt: readDate(raw, ACTIVATED_KEYS),
      };

      // Late-bound activation dates: the API stores none, so a caller can inject
      // them from its own history table without pre-processing every record.
      if (!bip.activatedAt && options.activationDateFor) {
        try {
          bip.activatedAt = parseBipDate(options.activationDateFor(bip));
        } catch {
          bip.activatedAt = null;
        }
      }

      bips.push(bip);
    } catch {
      // A getter or proxy on the input threw. One row is not worth the report.
      noteSkip("threw-while-reading", `index ${index}`);
    }
  });

  const unknownStatuses: CategoryCount[] = [...unknownStatusCounts.entries()]
    .map(([name, count]) => ({ name, count, share: share(count, bips.length) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    bips,
    quality: {
      total: records.length,
      analyzed: bips.length,
      skipped: records.length - bips.length,
      skipReasons: [...skips.values()].sort((a, b) => b.count - a.count),
      missingCreatedDate,
      unknownStatuses,
    },
  };
}
