/**
 * Translate our internal shapes into the exact JSON the React frontend already
 * expects (`SentimentData` in `src/frontend/src/api/types.ts`).
 *
 * The two vocabularies genuinely disagree, so every mismatch is resolved here —
 * in one place — rather than being smeared across the server:
 *
 *  - Stance casing: ours is lowercase `favour | against | neutral`, theirs is
 *    capitalised `For | Against | Neutral` (and "For", never "Favour").
 *  - Sats: they want one `totalSats` number, we track the two sides of the zap
 *    vote separately. We sum for `totalSats` and keep the split in extra
 *    fields so the more interesting number is not thrown away.
 *  - `score` is their name for the gauge, on -100..+100 (the UI prints it as a
 *    signed integer, e.g. "+76"). WHAT PRODUCES IT NOW DEPENDS ON THE MODE, and
 *    `scoreBasis` says which — see below.
 *  - `against` / `neutral` / `for` are **percentages**, not counts — the UI
 *    feeds them straight into `style={{ width: `${x}%` }}` on a 3-segment bar.
 *    Counts live in the extra `counts` field.
 *
 * ## TWO SCORES, ON PURPOSE
 *
 * The default `zaps` mode weights the gauge by MONEY:
 * `(satsFor - satsAgainst) / (satsFor + satsAgainst) * 100`. The free votes are
 * still reported, as counts and percentages, because the interesting thing on
 * screen is the DIVERGENCE — a proposal 70% of npubs like and 90% of the sats
 * are against is the whole point of the product. So both are always present:
 * `satsScore` (money) and `voteScore` (headcount), with `score` carrying
 * whichever one the active mode considers the gauge.
 *
 * ## ZERO IS NOT AN ANSWER
 *
 * "Nobody has weighed in" and "opinion is exactly split" both render as 0, and
 * they mean opposite things. Three fields keep them apart, and the UI should
 * branch on them rather than on `score === 0`:
 *
 *   - `hasSignal: false` — literally nothing was found. Show an empty state.
 *   - `scoreBasis: "none"` — `score` is a placeholder, not a measurement.
 *   - `satsScore` / `voteScore` are `null` when that signal has no denominator.
 *
 * Extra fields are additive: the frontend's structural type ignores them, so
 * adding them is safe, and they save the next person from re-deriving data we
 * already computed.
 */
import { nip19 } from "nostr-tools";
import type {
  ClassifiedNote,
  OpinionTally,
  SentimentSummary,
  Stance,
} from "@soft-fork-wiki/shared";

/** Mirrors the frontend's `SentimentChoice`. */
export type SentimentChoice = "Against" | "Neutral" | "For";

/**
 * Which pipeline produced a response.
 *
 * Always present in the payload, because the two are not interchangeable and a
 * caller must never have to guess: `zaps` is relay reads plus arithmetic and
 * answers in milliseconds; `llm` is a classification pass over scraped
 * discussion and answers in tens of seconds. The service never silently falls
 * back from one to the other.
 */
export type SentimentMode = "zaps" | "llm";

/**
 * What `score` was actually computed from.
 *
 *  - `"sats"`  money-weighted over verified zap receipts (mode `zaps`).
 *  - `"notes"` stance-weighted over LLM-classified notes (mode `llm`).
 *  - `"none"`  nothing to weigh. `score` is 0 as a placeholder ONLY.
 */
export type ScoreBasis = "sats" | "notes" | "none";

/** Mirrors the frontend's `SentimentNote`. */
export interface SentimentNote {
  author: string;
  choice: SentimentChoice;
  note: string;
  /** Relative age, e.g. "now", "42m", "5h", "3d". */
  time: string;
}

/** Raw stance counts, kept alongside the percentages the UI renders. */
export interface StanceCounts {
  favour: number;
  against: number;
  neutral: number;
}

/**
 * What happened to the zap receipts behind a `zaps`-mode response.
 *
 * Present so a demo can answer "why didn't my zap move the needle?" on the
 * spot: a receipt refused by the `"lnurl"` policy shows up as `rejected` with
 * its claimed sats in `rejectedSats`, rather than vanishing.
 */
export interface ZapAudit {
  /** Validation policy applied. `"lnurl"` is the default and the only safe one. */
  trust: string;
  /** Receipts whose sats are included in the totals. */
  accepted: number;
  /** Receipts refused by the policy. Non-zero on a public relay is normal. */
  rejected: number;
  /** Sats those refused receipts claimed. */
  rejectedSats: number;
  /** Ours, but stating no amount we could read. */
  skipped: number;
}

/**
 * The response body of `GET /sentiment/:bipNumber`.
 *
 * The first eight fields are the frontend's `SentimentData` contract, byte for
 * byte. Everything after is additive context that the current UI ignores.
 */
export interface SentimentData {
  bipNumber: number;
  /** Percent of `counts` against (0..100). */
  against: number;
  /** Percent of `counts` neutral (0..100). */
  neutral: number;
  /** Percent of `counts` in favour (0..100). */
  for: number;
  /** People who actually cast a vote. Not the size of the analyzed sample. */
  totalVotes: number;
  totalSats: number;
  /** The gauge, -100 (all against) .. +100 (all in favour). See `scoreBasis`. */
  score: number;
  recentNotes: SentimentNote[];

  // --- extra fields, not part of the frontend contract ---

  /** Which pipeline produced this response. Never inferred, always stated. */
  mode: SentimentMode;
  /** What `score` was computed from. `"none"` means `score` is a placeholder. */
  scoreBasis: ScoreBasis;
  /** False when nothing at all was found: no sats, no votes, no notes. */
  hasSignal: boolean;
  /** Money-weighted score over verified zaps, or null when no sats were zapped. */
  satsScore: number | null;
  /** Headcount-weighted score over `counts`, or null when `counts` is empty. */
  voteScore: number | null;
  /**
   * True only when NOT ONE relay completed its read — the numbers below are
   * not backed by any full view. A single slow relay does NOT set this; see
   * `relays` vs `relaysAnswered` for that, and `opinions.ts` for why.
   */
  degraded: boolean;
  /** Sats zapped to the FOR side (our `zappedSatsFavour`). */
  totalSatsFor: number;
  /** Sats zapped to the AGAINST side (our `zappedSatsAgainst`). */
  totalSatsAgainst: number;
  /**
   * Absolute stance counts behind the percentages. In `zaps` mode these are
   * FREE votes only (poll responses + opinion notes); in `llm` mode they are
   * the classified notes.
   */
  counts: StanceCounts;
  /** Notes analyzed for this result. */
  sampleSize: number;
  /** Distinct pubkeys that cast an explicit poll/note/zap opinion. */
  uniqueVoters: number;
  /** LLM-written synthesis. Empty string in `zaps` mode — no LLM ran. */
  narrative: string;
  /** When the underlying analysis ran (unix seconds). */
  computedAt: number;
  /** Zap receipt audit. `zaps` mode only. */
  zapAudit?: ZapAudit;
  /** Measured relay read time, in milliseconds. `zaps` mode only. */
  elapsedMs?: number;
  /** Relays queried, so a surprising number is traceable. `zaps` mode only. */
  relays?: string[];
  /**
   * Relays that finished every read inside the budget. `zaps` mode only.
   * Expect this to be shorter than `relays`: relay.damus.io routinely takes
   * seconds to EOSE on a `#t` filter and gets cut off — see `relays.ts`.
   */
  relaysAnswered?: string[];
}

/** Percentages of the three-segment sentiment bar. Always sums to 100 (or 0). */
export interface StancePercentages {
  for: number;
  against: number;
  neutral: number;
}

/** Longest note body we echo back; the UI shows these in small cards. */
const MAX_NOTE_CHARS = 280;

/** Leading chars of an abbreviated npub: the `npub1` prefix plus 4 of the key. */
const NPUB_HEAD_CHARS = 9;
/** Trailing chars kept, matching the mock's `npub1…7k2m`. */
const NPUB_TAIL_CHARS = 4;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

/** Map our lowercase `Stance` onto the frontend's capitalised `SentimentChoice`. */
export function toChoice(stance: Stance): SentimentChoice {
  switch (stance) {
    case "favour":
      return "For";
    case "against":
      return "Against";
    default:
      return "Neutral";
  }
}

/**
 * Abbreviate a hex pubkey the way the UI expects: `npub1abcd…7k2m`.
 *
 * The frontend's mock authors look like `npub1…7k2m`, and the whole sentiment
 * panel is laid out around that shape — raw hex would read as a rendering bug
 * on screen. We keep a few chars of the encoded key after the `npub1` prefix so
 * two authors are still visually distinguishable, since the last four alone
 * collide easily.
 *
 * `npubEncode` throws on anything that isn't a 32-byte hex key, so a malformed
 * pubkey from a relay falls back to truncated hex rather than failing the whole
 * response.
 */
export function shortAuthor(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, NPUB_HEAD_CHARS)}…${npub.slice(-NPUB_TAIL_CHARS)}`;
  } catch {
    if (pubkey.length <= 13) return pubkey;
    return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
  }
}

/**
 * Format a note's age the way the mock does ("now" / "42m" / "5h" / "3d").
 *
 * `now` is a parameter rather than a `Date.now()` call so this stays pure and
 * the output is reproducible in a test.
 */
export function relativeTime(createdAt: number, now: number): string {
  const delta = Math.max(0, now - createdAt);
  if (delta < MINUTE) return "now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < MONTH) return `${Math.floor(delta / DAY)}d`;
  return `${Math.floor(delta / MONTH)}mo`;
}

/**
 * Convert counts to whole percentages that add up to exactly 100.
 *
 * Naive rounding can produce 33/33/33 (a visible gap in the bar) or 34/33/34
 * (overflow). Largest-remainder distribution keeps the bar flush.
 */
export function toPercentages(counts: StanceCounts): StancePercentages {
  const total = counts.favour + counts.against + counts.neutral;
  if (total <= 0) return { for: 0, against: 0, neutral: 0 };

  const exact = [
    { key: "against" as const, value: (counts.against / total) * 100 },
    { key: "neutral" as const, value: (counts.neutral / total) * 100 },
    { key: "for" as const, value: (counts.favour / total) * 100 },
  ];

  const out: StancePercentages = { for: 0, against: 0, neutral: 0 };
  let assigned = 0;
  for (const part of exact) {
    const floored = Math.floor(part.value);
    out[part.key] = floored;
    assigned += floored;
  }

  const byRemainder = [...exact].sort((a, b) => (b.value % 1) - (a.value % 1));
  for (let i = 0; i < 100 - assigned; i += 1) {
    const part = byRemainder[i % byRemainder.length];
    if (part) out[part.key] += 1;
  }
  return out;
}

/**
 * The money-weighted gauge: `(for - against) / (for + against) * 100`.
 *
 * Returns **null**, not 0, when no sats were zapped either way. Zero is a real
 * answer here (equal sats on both sides, a genuinely contested proposal) and
 * conflating it with "no money has moved" is the one thing this API must not
 * do. Callers turn the null into a display value themselves.
 */
export function moneyWeightedScore(
  satsFor: number,
  satsAgainst: number,
): number | null {
  const forSats = Math.max(0, safeNumber(satsFor));
  const againstSats = Math.max(0, safeNumber(satsAgainst));
  const total = forSats + againstSats;
  if (total <= 0) return null;
  return clampScore(Math.round(((forSats - againstSats) / total) * 100));
}

/**
 * The headcount gauge, over the same -100..+100 range.
 *
 * Neutral votes are in the denominator on purpose: an electorate that is mostly
 * undecided should read as near-zero conviction, not as a landslide decided by
 * the two people who picked a side.
 */
export function headcountScore(counts: StanceCounts): number | null {
  const favour = Math.max(0, safeNumber(counts.favour));
  const against = Math.max(0, safeNumber(counts.against));
  const neutral = Math.max(0, safeNumber(counts.neutral));
  const total = favour + against + neutral;
  if (total <= 0) return null;
  return clampScore(Math.round(((favour - against) / total) * 100));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-100, Math.min(100, value));
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Map one classified Nostr note onto the frontend's `SentimentNote`. */
export function toSentimentNote(note: ClassifiedNote, now: number): SentimentNote {
  const body = note.content.trim();
  return {
    author: shortAuthor(note.pubkey),
    choice: toChoice(note.stance),
    note:
      body.length > MAX_NOTE_CHARS ? `${body.slice(0, MAX_NOTE_CHARS - 1)}…` : body,
    time: relativeTime(note.createdAt, now),
  };
}

export interface AdaptInput {
  /** Aggregate produced by the sentiment package. */
  summary: SentimentSummary;
  /** The individual classified notes behind that summary. */
  notes: ClassifiedNote[];
  /** Poll/zap tally produced by the voting package. */
  tally: OpinionTally;
  /** Unix seconds "now", used for the relative timestamps. */
  now: number;
  /** How many notes to include in `recentNotes`. */
  recentNoteLimit: number;
}

/**
 * Fold an LLM sentiment summary, its notes, and the vote tally into one
 * frontend-shaped payload. `mode: "llm"`.
 *
 * `totalVotes` is `tally.uniqueVoters` — distinct people who actually expressed
 * a vote (poll response, opinion event, or zap), deduplicated by pubkey across
 * all three mechanisms. It is deliberately NOT the analyzed sample size: the UI
 * presents this as "N signals", and reporting scraped Nostr chatter there would
 * claim 40 votes when two people voted. The sample size stays available, under
 * its own honest name, in `sampleSize`.
 *
 * Consequence worth knowing: the sentiment panel hides itself when
 * `totalVotes === 0` (`BipPages.tsx`), so a BIP with rich discussion but no
 * in-app votes now renders the empty state. That is the frontend's condition to
 * relax (to `sampleSize === 0`) if it wants the analysis visible regardless.
 */
export function toSentimentData(input: AdaptInput): SentimentData {
  const { summary, notes, tally, now, recentNoteLimit } = input;

  const counts: StanceCounts = {
    favour: summary.favour,
    against: summary.against,
    neutral: summary.neutral,
  };
  const percentages = toPercentages(counts);
  const totalSatsFor = tally.zappedSatsFavour;
  const totalSatsAgainst = tally.zappedSatsAgainst;

  // Newest first — "recent notes" in the UI is ordered, not just sampled.
  const recentNotes = [...notes]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, recentNoteLimit)
    .map((note) => toSentimentNote(note, now));

  const hasNotes = summary.sampleSize > 0;

  return {
    bipNumber: summary.bipNumber,
    against: percentages.against,
    neutral: percentages.neutral,
    for: percentages.for,
    totalVotes: tally.uniqueVoters,
    totalSats: totalSatsFor + totalSatsAgainst,
    // With nothing classified, `netScore` is a division-by-zero guard's 0, not
    // a measurement. Say so through `scoreBasis` rather than shipping a 0 that
    // reads as "the network is perfectly split".
    score: hasNotes ? clampScore(Math.round(summary.netScore * 100)) : 0,
    recentNotes,
    mode: "llm",
    scoreBasis: hasNotes ? "notes" : "none",
    hasSignal:
      hasNotes || tally.uniqueVoters > 0 || totalSatsFor + totalSatsAgainst > 0,
    satsScore: moneyWeightedScore(totalSatsFor, totalSatsAgainst),
    voteScore: headcountScore(counts),
    degraded: false,
    totalSatsFor,
    totalSatsAgainst,
    counts,
    sampleSize: summary.sampleSize,
    uniqueVoters: tally.uniqueVoters,
    narrative: summary.narrative ?? "",
    computedAt: summary.computedAt,
  };
}

export interface ZapAdaptInput {
  bipNumber: number;
  /** All mechanisms folded together: `uniqueVoters` and the two sats totals. */
  tally: OpinionTally;
  /** FREE vote counts only (poll responses + opinion notes), for the bar. */
  freeCounts: StanceCounts;
  /** Stated opinions that carried text, newest first. */
  notes: ClassifiedNote[];
  /** Zap receipt audit trail. */
  zapAudit: ZapAudit;
  /** True when a relay read timed out or failed. */
  degraded: boolean;
  /** Measured relay read time. */
  elapsedMs: number;
  relays: string[];
  relaysAnswered: string[];
  /** Unix seconds "now". */
  now: number;
  recentNoteLimit: number;
}

/**
 * Build the payload from zaps and votes alone. No LLM, no classification, no
 * network call beyond the relay reads that produced `tally`. `mode: "zaps"`.
 *
 * `recentNotes` here are STATED opinions — kind:1 notes carrying our app tag
 * and a NIP-32 stance label — not scraped discussion. That keeps the panel
 * populated without a classifier, and every card on screen is something its
 * author explicitly said about this BIP.
 *
 * `narrative` is deliberately the empty string: nothing wrote one, and inventing
 * a sentence here would be the service pretending it did work it did not do.
 */
export function toZapSentimentData(input: ZapAdaptInput): SentimentData {
  const { tally, freeCounts, notes, now, recentNoteLimit } = input;

  const percentages = toPercentages(freeCounts);
  const totalSatsFor = tally.zappedSatsFavour;
  const totalSatsAgainst = tally.zappedSatsAgainst;
  const totalSats = totalSatsFor + totalSatsAgainst;

  const satsScore = moneyWeightedScore(totalSatsFor, totalSatsAgainst);
  const voteScore = headcountScore(freeCounts);

  const recentNotes = [...notes]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, recentNoteLimit)
    .map((note) => toSentimentNote(note, now));

  return {
    bipNumber: input.bipNumber,
    against: percentages.against,
    neutral: percentages.neutral,
    for: percentages.for,
    totalVotes: tally.uniqueVoters,
    totalSats,
    // The gauge follows the money. `satsScore === null` means no sats moved, in
    // which case 0 is a placeholder and `scoreBasis: "none"` says so.
    score: satsScore ?? 0,
    recentNotes,
    mode: "zaps",
    scoreBasis: satsScore === null ? "none" : "sats",
    hasSignal: totalSats > 0 || tally.uniqueVoters > 0 || notes.length > 0,
    satsScore,
    voteScore,
    degraded: input.degraded,
    totalSatsFor,
    totalSatsAgainst,
    counts: freeCounts,
    // Nothing was "analyzed" — these are stated opinions, and calling them a
    // sample would overstate what this mode did.
    sampleSize: notes.length,
    uniqueVoters: tally.uniqueVoters,
    narrative: "",
    computedAt: now,
    zapAudit: input.zapAudit,
    elapsedMs: input.elapsedMs,
    relays: input.relays,
    relaysAnswered: input.relaysAnswered,
  };
}
