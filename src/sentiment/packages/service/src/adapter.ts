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
 *  - `score` is their name for our `netScore`, rescaled from -1..+1 to
 *    -100..+100 (the UI prints it as a signed integer, e.g. "+76").
 *  - `against` / `neutral` / `for` are **percentages**, not counts — the UI
 *    feeds them straight into `style={{ width: `${x}%` }}` on a 3-segment bar.
 *    Counts live in the extra `counts` field.
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
 * The response body of `GET /sentiment/:bipNumber`.
 *
 * The first eight fields are the frontend's `SentimentData` contract, byte for
 * byte. Everything after is additive context that the current UI ignores.
 */
export interface SentimentData {
  bipNumber: number;
  /** Percent of classified notes against (0..100). */
  against: number;
  /** Percent of classified notes neutral (0..100). */
  neutral: number;
  /** Percent of classified notes in favour (0..100). */
  for: number;
  /** People who actually cast a vote. Not the size of the analyzed sample. */
  totalVotes: number;
  totalSats: number;
  /** Net score, -100 (all against) .. +100 (all in favour). */
  score: number;
  recentNotes: SentimentNote[];

  // --- extra fields, not part of the frontend contract ---

  /** Sats zapped to the FOR side (our `zappedSatsFavour`). */
  totalSatsFor: number;
  /** Sats zapped to the AGAINST side (our `zappedSatsAgainst`). */
  totalSatsAgainst: number;
  /** Absolute stance counts behind the percentages. */
  counts: StanceCounts;
  /** Notes analyzed for this result. */
  sampleSize: number;
  /** Distinct pubkeys that cast an explicit poll/zap opinion. */
  uniqueVoters: number;
  /** LLM-written one-paragraph synthesis of the discussion. */
  narrative: string;
  /** When the underlying analysis ran (unix seconds). */
  computedAt: number;
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
 * Fold a sentiment summary, its notes, and the vote tally into one
 * frontend-shaped payload.
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

  // Newest first — "recent notes" in the UI is ordered, not just sampled.
  const recentNotes = [...notes]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, recentNoteLimit)
    .map((note) => toSentimentNote(note, now));

  return {
    bipNumber: summary.bipNumber,
    against: percentages.against,
    neutral: percentages.neutral,
    for: percentages.for,
    totalVotes: tally.uniqueVoters,
    totalSats: tally.zappedSatsFavour + tally.zappedSatsAgainst,
    score: Math.round(summary.netScore * 100),
    recentNotes,
    totalSatsFor: tally.zappedSatsFavour,
    totalSatsAgainst: tally.zappedSatsAgainst,
    counts,
    sampleSize: summary.sampleSize,
    uniqueVoters: tally.uniqueVoters,
    narrative: summary.narrative ?? "",
    computedAt: summary.computedAt,
  };
}
