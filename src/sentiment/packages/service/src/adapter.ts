/**
 * Translate our internal shapes into the exact JSON the React frontend already
 * expects (`SentimentData` in `src/frontend/src/api/types.ts`).
 *
 * The two vocabularies genuinely disagree, so every mismatch is resolved here —
 * in one place — rather than being smeared across the server:
 *
 *  - Stance casing: ours is lowercase `favour | against | neutral`, theirs is
 *    capitalised `For | Against | Neutral` (and "For", never "Favour").
 *  - Sats: they want one `totalSats` number, we track several different pots of
 *    money and must never let them blur into each other. See below.
 *  - `score` is their name for the gauge, on -100..+100 (the UI prints it as a
 *    signed integer, e.g. "+76"). WHAT PRODUCES IT NOW DEPENDS ON THE MODE, and
 *    `scoreBasis` says which — see below.
 *  - `against` / `neutral` / `for` are **percentages**, not counts — the UI
 *    feeds them straight into `style={{ width: `${x}%` }}` on a 3-segment bar.
 *    Counts live in the extra `counts` field.
 *
 * ## TWO POTS OF MONEY, NEVER MIXED
 *
 * `zaps` mode now reports two completely different things, and the whole point
 * of this file is that a caller can always tell which is which:
 *
 *  - `discussionZaps` — sats zapped by real people onto PUBLIC Nostr posts that
 *    discuss this BIP. This is money that already exists on the network, found
 *    by `discussion.ts`. It is a MAGNITUDE: "76,353 sats are behind the
 *    conversation about BIP 158". It has NO direction, because a zap on a post
 *    does not say whether the post was for or against the proposal.
 *  - `appVotes` — votes cast THROUGH THIS APP: NIP-88 poll responses,
 *    app-tagged opinion notes, and zaps anchored to those. These carry an
 *    explicit stance, so they are the only sats that can be split for/against.
 *    They are zero until somebody uses the app, and reporting them as zero is
 *    correct rather than embarrassing.
 *
 * "10,117 sats zapped on posts about this BIP" and "0 votes cast here" are two
 * true statements at once, and both are in the payload, separately.
 *
 * `totalSats` is the sum of the two, i.e. all verified sats behind this BIP on
 * Nostr — that is the headline number a UI wants. It deliberately does NOT
 * equal `totalSatsFor + totalSatsAgainst`, and it never could: those two are
 * app-only, because they are the only sats whose side is known.
 *
 * ## TWO SCORES, ON PURPOSE
 *
 * `satsScore` weights the gauge by MONEY over app zaps only:
 * `(satsFor - satsAgainst) / (satsFor + satsAgainst) * 100`. `voteScore` is the
 * headcount over free votes. Both are always present, because the interesting
 * thing on screen is the DIVERGENCE — a proposal 70% of npubs like and 90% of
 * the sats are against is the whole point of the product.
 *
 * ## ZERO IS NOT AN ANSWER, AND NEITHER IS A FAKE NEEDLE
 *
 * "Nobody has weighed in", "opinion is exactly split" and "there is a lot of
 * money here but nothing that says which way" all render as 0, and they mean
 * three different things. Four fields keep them apart, and the UI should branch
 * on them rather than on `score === 0`:
 *
 *   - `hasSignal: false` — literally nothing was found. Show an empty state.
 *   - `hasDirection: false` — nothing establishes a for/against split. Show the
 *     magnitude, not a needle.
 *   - `scoreBasis: "magnitude"` — `score` is 0 as a PLACEHOLDER; the real
 *     reading is `discussionZaps.sats`. `"none"` means even that is empty.
 *   - `satsScore` / `voteScore` are `null` when that signal has no denominator.
 *
 * Splitting discussion zaps into for/against would mean knowing what each post
 * argues, which is a classification problem and belongs to `?mode=llm` — Phase
 * 2. Until then this file refuses to guess, and says so in `directionNote`.
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
import type { DiscoveryMethod } from "@soft-fork-wiki/sentiment";
import type { DiscussionSignals } from "./discussion.js";
import { lnurlCacheStats, type LnurlCacheStats } from "./lnurlcache.js";

/** Mirrors the frontend's `SentimentChoice`. */
export type SentimentChoice = "Against" | "Neutral" | "For";

/**
 * Which pipeline produced a response.
 *
 * Always present in the payload, because the two are not interchangeable and a
 * caller must never have to guess: `zaps` is relay reads plus arithmetic and
 * answers in milliseconds to seconds; `llm` is a classification pass over
 * scraped discussion and answers in tens of seconds. The service never silently
 * falls back from one to the other.
 */
export type SentimentMode = "zaps" | "llm";

/**
 * What `score` was actually computed from.
 *
 *  - `"sats"`      money-weighted over verified APP zaps that named a side.
 *  - `"notes"`     stance-weighted over LLM-classified notes (mode `llm`).
 *  - `"magnitude"` there IS money and engagement behind this BIP, but nothing
 *                  that says which way it points. `score` is 0 as a placeholder
 *                  ONLY; read `discussionZaps.sats`. Direction needs Phase 2.
 *  - `"none"`      nothing to weigh at all. `score` is 0 as a placeholder ONLY.
 */
export type ScoreBasis = "sats" | "notes" | "magnitude" | "none";

/**
 * The one-line explanation of why `zaps` mode does not produce a needle. Shipped
 * in the payload so a UI (or a person reading curl output) does not have to
 * infer it from a flag.
 */
export const DIRECTION_NOTE =
  "Zaps on public posts measure how much money is behind the discussion of this " +
  "BIP, not which way it leans: paying for a post does not say whether the post " +
  "argued for or against. Splitting these sats for/against requires classifying " +
  "what each post says, which is mode=llm (Phase 2). Only appVotes carry a " +
  "stated stance and can move a needle.";

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

/** A public post that drew sats, as the frontend should show it. */
export interface ZappedPost {
  /** Nostr event id, so a client can link straight to the post. */
  eventId: string;
  /** Abbreviated npub of the author. */
  author: string;
  /** Opening of the post, whitespace collapsed. */
  excerpt: string;
  /** Verified sats zapped to this post. */
  sats: number;
  /** Verified zap receipts on this post. */
  zaps: number;
  reactions: number;
  replies: number;
  /** Unix seconds. */
  createdAt: number;
  /** Relative age, same format as `SentimentNote.time`. */
  time: string;
  /** Which lane found it: `tag`, `search`, or `longform`. */
  discovery: DiscoveryMethod;
}

/**
 * Money and attention on PUBLIC posts about this BIP. Magnitude, no direction.
 *
 * Every sat here was paid by a real person to a real post and verified against
 * the recipient's own LNURL-pay endpoint. None of it was cast through this app,
 * and none of it says for or against — see `DIRECTION_NOTE`.
 */
export interface DiscussionZaps {
  /** Total verified sats zapped across the sampled posts. The headline number. */
  sats: number;
  /** Verified zap receipts behind `sats`. */
  zaps: number;
  /** Distinct pubkeys that paid at least one verified zap. */
  zappers: number;
  /**
   * Receipts the distinct-zapper pass verified — the denominator behind
   * `zappers`. It reads the relays independently of the sats pass, so comparing
   * this with `zaps` shows how far the two views drifted apart.
   */
  zappersFrom: number;
  /** NIP-25 positive reactions across the sample. */
  reactions: number;
  /** NIP-25 `"-"` reactions, deliberately kept out of `reactions`. */
  downvotes: number;
  /** Replies across the sample. */
  replies: number;
  /** Posts discovered and measured. */
  posts: number;
  /** Posts that drew at least one verified zap. */
  postsZapped: number;
  /** The cap applied to `posts`, so truncation is never silent. */
  postLimit: number;
  /** True when discovery found more posts than `postLimit` allowed. */
  truncated: boolean;
  /** Posts the cap dropped, oldest first. */
  postsDropped: number;
  /** Receipts refused by the trust policy. Non-zero on public relays is normal. */
  rejected: number;
  /** Sats those refused receipts claimed — the size of what was turned away. */
  rejectedSats: number;
  /** Receipts stating no amount we could read. */
  skipped: number;
  /** Policy applied. `"lnurl"` is the default and the only forgery-resistant one. */
  trust: string;
  /** True when relay trouble or the budget stopped us getting a real read. */
  degraded: boolean;
  /** Measured wall time of the discovery + engagement read, milliseconds. */
  elapsedMs: number;
  /** How old this read is, milliseconds. Non-zero means it came from cache. */
  ageMs: number;
  /** LNURL endpoint memo counters — why a warm request is fast. */
  lnurlCache: LnurlCacheStats;
  /** The posts that drew the most sats, richest first. */
  topPosts: ZappedPost[];
}

/**
 * Votes cast THROUGH THIS APP. Zero until somebody uses it, and that zero is a
 * measurement, not a failure.
 *
 * These are the only signals that carry a stated stance, so they are the only
 * ones that can produce a for/against split or move `score`.
 */
export interface AppVotes {
  /** Distinct pubkeys that cast a poll response, opinion note, or app zap. */
  votes: number;
  /** Stance counts from FREE votes only: poll responses and opinion notes. */
  counts: StanceCounts;
  /** Sats zapped through the app, both sides. */
  sats: number;
  /** Sats zapped to the FOR side. */
  satsFor: number;
  /** Sats zapped to the AGAINST side. */
  satsAgainst: number;
  /** App-tagged opinion notes that carried text. */
  notes: number;
  /** What happened to the app-anchored zap receipts. */
  zapAudit: ZapAudit;
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
  /**
   * People who cast a vote IN THIS APP. Not the size of the analyzed sample,
   * and NOT the number of people who zapped public posts — that is
   * `discussionZaps.zappers`.
   */
  totalVotes: number;
  /**
   * All verified sats behind this BIP: `discussionZaps.sats + appVotes.sats`.
   * Does NOT equal `totalSatsFor + totalSatsAgainst`; those are app-only,
   * because they are the only sats whose side is known.
   */
  totalSats: number;
  /** The gauge, -100 (all against) .. +100 (all in favour). See `scoreBasis`. */
  score: number;
  recentNotes: SentimentNote[];

  // --- extra fields, not part of the frontend contract ---

  /** Which pipeline produced this response. Never inferred, always stated. */
  mode: SentimentMode;
  /** What `score` was computed from. `"magnitude"`/`"none"` mean placeholder. */
  scoreBasis: ScoreBasis;
  /** False when nothing at all was found: no sats, no votes, no notes. */
  hasSignal: boolean;
  /**
   * True only when something in this payload establishes a for/against split.
   * False in the normal Phase 1 case, where there is real money but no stance.
   * A UI must not draw a needle when this is false.
   */
  hasDirection: boolean;
  /** Why `hasDirection` is false and what would fix it. See `DIRECTION_NOTE`. */
  directionNote: string;
  /** Money on public posts about this BIP. Magnitude only. `zaps` mode only. */
  discussionZaps?: DiscussionZaps;
  /** Votes cast through this app. `zaps` mode only. */
  appVotes?: AppVotes;
  /** Money-weighted score over app zaps, or null when no app sats were zapped. */
  satsScore: number | null;
  /** Headcount-weighted score over `counts`, or null when `counts` is empty. */
  voteScore: number | null;
  /**
   * True only when NOT ONE relay completed its read — the numbers below are
   * not backed by any full view. A single slow relay does NOT set this; see
   * `relays` vs `relaysAnswered` for that, and `opinions.ts` for why.
   */
  degraded: boolean;
  /** Sats zapped to the FOR side through the app (our `zappedSatsFavour`). */
  totalSatsFor: number;
  /** Sats zapped to the AGAINST side through the app (`zappedSatsAgainst`). */
  totalSatsAgainst: number;
  /**
   * Absolute stance counts behind the percentages. In `zaps` mode these are
   * FREE app votes only (poll responses + opinion notes); in `llm` mode they are
   * the classified notes.
   */
  counts: StanceCounts;
  /** Notes analyzed for this result. */
  sampleSize: number;
  /** Distinct pubkeys that cast an explicit poll/note/zap opinion in the app. */
  uniqueVoters: number;
  /** LLM-written synthesis. Empty string in `zaps` mode — no LLM ran. */
  narrative: string;
  /** When the underlying analysis ran (unix seconds). */
  computedAt: number;
  /** True when this response came from the bundled captured-reading snapshot. */
  snapshot?: boolean;
  /** App-zap receipt audit. `zaps` mode only. */
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
    // The LLM path classifies every note, so its score IS a direction.
    hasDirection: hasNotes,
    directionNote: hasNotes
      ? "Direction comes from LLM classification of each note's stance."
      : DIRECTION_NOTE,
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
  /** App mechanisms folded together: `uniqueVoters` and the two sats totals. */
  tally: OpinionTally;
  /** FREE app vote counts only (poll responses + opinion notes), for the bar. */
  freeCounts: StanceCounts;
  /** Stated app opinions that carried text, newest first. */
  notes: ClassifiedNote[];
  /** App-zap receipt audit trail. */
  zapAudit: ZapAudit;
  /** Money and attention on PUBLIC posts about this BIP. */
  discussion: DiscussionSignals;
  /** True when a relay read for the APP signals timed out or failed. */
  degraded: boolean;
  /** Measured relay read time for the app signals. */
  elapsedMs: number;
  relays: string[];
  relaysAnswered: string[];
  /** Unix seconds "now". */
  now: number;
  recentNoteLimit: number;
}

/**
 * Build the payload from public zaps and app votes. No LLM, no classification.
 * `mode: "zaps"`.
 *
 * The two halves are assembled independently and never added together except in
 * `totalSats`, which is explicitly documented as the sum. `score` follows the
 * APP zaps only, because they are the only ones that named a side; when there
 * are none, `score` is 0 with `scoreBasis: "magnitude"` (there is money, but no
 * direction) or `"none"` (there is nothing), and `hasDirection` is false either
 * way. Nothing here invents a needle out of `discussionZaps.sats`.
 *
 * `recentNotes` are STATED opinions — kind:1 notes carrying our app tag and a
 * NIP-32 stance label — not scraped discussion, so every card on screen is
 * something its author explicitly said about this BIP. Public posts appear
 * separately, and only when they drew sats, in `discussionZaps.topPosts`.
 *
 * `narrative` is deliberately the empty string: nothing wrote one, and inventing
 * a sentence here would be the service pretending it did work it did not do.
 */
export function toZapSentimentData(input: ZapAdaptInput): SentimentData {
  const { tally, freeCounts, notes, discussion, now, recentNoteLimit } = input;

  const percentages = toPercentages(freeCounts);
  const appSatsFor = tally.zappedSatsFavour;
  const appSatsAgainst = tally.zappedSatsAgainst;
  const appSats = appSatsFor + appSatsAgainst;

  // App-only, and deliberately so: these are the sats whose side is known.
  const satsScore = moneyWeightedScore(appSatsFor, appSatsAgainst);
  const voteScore = headcountScore(freeCounts);
  const hasDirection = satsScore !== null;

  const discussionZaps = toDiscussionZaps(discussion, now);
  const hasDiscussion =
    discussion.sats > 0 || discussion.zaps > 0 || discussion.posts > 0;

  const recentNotes = [...notes]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, recentNoteLimit)
    .map((note) => toSentimentNote(note, now));

  const appVotes: AppVotes = {
    votes: tally.uniqueVoters,
    counts: freeCounts,
    sats: appSats,
    satsFor: appSatsFor,
    satsAgainst: appSatsAgainst,
    notes: notes.length,
    zapAudit: input.zapAudit,
  };

  return {
    bipNumber: input.bipNumber,
    against: percentages.against,
    neutral: percentages.neutral,
    for: percentages.for,
    // Votes cast in the app. Zero until somebody uses it, and NOT the number of
    // people who zapped public posts — that is `discussionZaps.zappers`.
    totalVotes: tally.uniqueVoters,
    totalSats: discussion.sats + appSats,
    // Only app zaps can point. With none, this 0 is a placeholder and
    // `scoreBasis` + `hasDirection` say so.
    score: satsScore ?? 0,
    recentNotes,
    mode: "zaps",
    scoreBasis: hasDirection ? "sats" : hasDiscussion ? "magnitude" : "none",
    hasSignal:
      hasDiscussion ||
      appSats > 0 ||
      tally.uniqueVoters > 0 ||
      notes.length > 0,
    hasDirection,
    directionNote: hasDirection
      ? "Direction comes from app zaps that named a side (NIP-32 stance label)."
      : DIRECTION_NOTE,
    discussionZaps,
    appVotes,
    satsScore,
    voteScore,
    degraded: input.degraded,
    totalSatsFor: appSatsFor,
    totalSatsAgainst: appSatsAgainst,
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

/**
 * Present the discussion read.
 *
 * `ageMs` and the relative times are derived from `now` rather than baked in by
 * `discussion.ts`, because that result is cached: a post's "3h" must not still
 * say "3h" five minutes later, and a caller must be able to see that the numbers
 * came from a read taken a while ago.
 */
function toDiscussionZaps(
  discussion: DiscussionSignals,
  now: number,
): DiscussionZaps {
  return {
    sats: discussion.sats,
    zaps: discussion.zaps,
    zappers: discussion.zappers,
    zappersFrom: discussion.zappersFrom,
    reactions: discussion.reactions,
    downvotes: discussion.downvotes,
    replies: discussion.replies,
    posts: discussion.posts,
    postsZapped: discussion.postsZapped,
    postLimit: discussion.postLimit,
    truncated: discussion.truncated,
    postsDropped: discussion.postsDropped,
    rejected: discussion.rejected,
    rejectedSats: discussion.rejectedSats,
    skipped: discussion.skipped,
    trust: discussion.trust,
    degraded: discussion.degraded,
    elapsedMs: discussion.elapsedMs,
    ageMs: Math.max(0, now * 1000 - discussion.computedAt),
    lnurlCache: lnurlCacheStats(),
    topPosts: discussion.topPosts.map((post) => ({
      eventId: post.eventId,
      author: shortAuthor(post.pubkey),
      excerpt: post.excerpt,
      sats: post.sats,
      zaps: post.zaps,
      reactions: post.reactions,
      replies: post.replies,
      createdAt: post.createdAt,
      time: relativeTime(post.createdAt, now),
      discovery: post.discovery,
    })),
  };
}
