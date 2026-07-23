/**
 * Rank classified notes and pick the best point of view per stance.
 *
 * The product question is "what are the best arguments for and against BIP N?",
 * not "who posted last". So we rank by what the network paid attention to.
 *
 * ## Zaps are the vote
 *
 * `zapSats` is the primary input. A zap is a Lightning payment attached to a
 * note (NIP-57), so it is a vote that cost the voter real money. That is a far
 * better signal than anything we could compute from the text, and it makes
 * spam self-limiting: flooding the board costs sats and earns none back. We do
 * not judge argument quality algorithmically — the market does it for us.
 *
 * Reactions (NIP-25) and replies come second: real signal, but free, so easier
 * to manufacture.
 *
 * ## Cold start
 *
 * Recency is a tiebreaker and, deliberately, the *only* fallback. Until zap and
 * reaction data is wired into `EngagementSignals`, every engagement term is
 * zero for every note and the ranking collapses cleanly to newest-first. That
 * is the state the demo opens in — see `scoreNote`.
 *
 * ## Confidence is not part of the score
 *
 * `ClassifiedNote.confidence` is the classifier's certainty about *which stance
 * label applies* (see `providers/prompt.ts`), not a measure of the argument. It
 * is used only to filter: a note the classifier was unsure about is probably in
 * the wrong bucket, and a note filed under "against" while it argues in favour
 * is worse than a missing note. That is classification hygiene, not quality
 * judgement.
 */
import type { ClassifiedNote, Stance } from "@soft-fork-wiki/shared";

/**
 * What the network did with a note.
 *
 * Not populated yet — `fetch.ts` queries kind:1 only. Every field is optional
 * so a caller can supply whichever signal it collects first; absent means zero,
 * never an error.
 */
export interface EngagementSignals {
  /**
   * Total sats zapped to this note (NIP-57 receipts, kind:9735). THE PRIMARY
   * RANKING INPUT — this is the paid vote.
   */
  zapSats?: number;
  /** NIP-25 reactions (kind:7) pointing at this note. Free signal, secondary. */
  reactions?: number;
  /** Replies to this note (kind:1 carrying an `e` tag). Secondary. */
  replies?: number;
}

/** A classified note plus what the network did with it. */
export interface RankableNote extends ClassifiedNote {
  engagement?: EngagementSignals;
}

/** The raw 0..1 signals behind a score, so the UI can explain a ranking. */
export interface ScoreComponents {
  zaps: number;
  reactions: number;
  replies: number;
  recency: number;
}

export interface ScoredNote {
  note: RankableNote;
  /** 0..1. */
  score: number;
  components: ScoreComponents;
}

export interface RankOptions {
  /**
   * Unix seconds treated as "now". The caller supplies it (as `summarize.ts`
   * does with `computedAt`) so a ranking is reproducible and testable.
   */
  now?: number;
  /** Days after which the recency component halves. */
  halfLifeDays?: number;
}

export interface TopNotesOptions extends RankOptions {
  /** How many notes to return per stance. */
  perStance?: number;
  /** Cap on notes from one pubkey within a single stance bucket. */
  maxPerAuthor?: number;
  /** Exclude notes whose stance label the classifier was unsure about. */
  minConfidence?: number;
}

/** Best notes per stance. All three keys always exist, possibly empty. */
export type TopNotesByStance = Record<Stance, ScoredNote[]>;

/**
 * Weights, in the priority order the product calls for: paid votes dominate,
 * free signal follows, recency only breaks ties. They sum to 1.
 *
 * The gap between zaps and recency is what makes this a ranking rather than a
 * feed: a note carrying a real zap outranks anything posted since.
 */
const WEIGHT_ZAPS = 0.6;
const WEIGHT_REACTIONS = 0.25;
const WEIGHT_REPLIES = 0.05;
const WEIGHT_RECENCY = 0.1;

/**
 * Counts at which each signal has earned most of its credit. Log-saturating, so
 * the interesting difference is between 0 and 10 reactions rather than between
 * 100 and 110, and one viral note cannot own the top slot forever.
 */
const ZAP_SAT_SATURATION = 10_000;
const REACTION_SATURATION = 25;
const REPLY_SATURATION = 10;

/**
 * A month keeps a whole cycle of discussion roughly comparable, which matters
 * because BIP debate has a long tail.
 */
const DEFAULT_HALF_LIFE_DAYS = 30;

/** Used when `createdAt` is unusable: neither reward nor punish the note. */
const UNKNOWN_RECENCY = 0.5;

const DEFAULT_PER_STANCE = 3;

/**
 * One note per author by default: three slots should mean three voices. The cap
 * is relaxed only as a last resort, when a bucket would otherwise sit half
 * empty (see `pickDiverse`).
 */
const DEFAULT_MAX_PER_AUTHOR = 1;

/** Below this, the stance label is not trustworthy enough to file under. */
const DEFAULT_MIN_CONFIDENCE = 0.35;

/**
 * Used when the classifier reported no usable confidence — a note is not worse
 * for a field the provider omitted.
 *
 * This deliberately also covers an exact `0`. `parseStanceJson` in
 * providers/prompt.ts does `Number(obj.confidence) || 0`, which collapses
 * "field absent", "unparseable" and "NaN" all into `0`. A model that has just
 * committed to a stance essentially never volunteers 0.0, so an exact zero is
 * far more likely to be that coercion than a real self-report. Reading it as
 * maximal distrust would silently delete every note from a provider whose JSON
 * hiccuped.
 */
const FALLBACK_CONFIDENCE = 0.5;

const STANCES: readonly Stance[] = ["favour", "against", "neutral"];

/**
 * Score one note.
 *
 *   score = 0.60 x zaps + 0.25 x reactions + 0.05 x replies + 0.10 x recency
 *
 * Never throws: every field is treated as untrusted, because `confidence`,
 * `createdAt` and `engagement` all originate from an LLM response or a relay we
 * do not control.
 */
export function scoreNote(
  note: RankableNote,
  opts: RankOptions = {},
): ScoredNote {
  const engagement = note?.engagement;
  const components: ScoreComponents = {
    zaps: saturating(engagement?.zapSats, ZAP_SAT_SATURATION),
    reactions: saturating(engagement?.reactions, REACTION_SATURATION),
    replies: saturating(engagement?.replies, REPLY_SATURATION),
    recency: recencyScore(
      note?.createdAt,
      resolveNow(opts.now),
      positiveNumber(opts.halfLifeDays, DEFAULT_HALF_LIFE_DAYS),
    ),
  };

  const paidAttention =
    WEIGHT_ZAPS * components.zaps +
    WEIGHT_REACTIONS * components.reactions +
    WEIGHT_REPLIES * components.replies;

  // COLD START: with nothing zapped or reacted to anywhere, `paidAttention` is
  // 0 for every note and the score reduces to `WEIGHT_RECENCY * recency` — a
  // pure newest-first ordering. That is intentional, and is the state the demo
  // opens in.
  const score = paidAttention + WEIGHT_RECENCY * components.recency;

  return { note, score, components };
}

/**
 * Score every note and return them best-first. No filtering happens here — this
 * is the ordering primitive; `topNotesByStance` decides what is fit to show.
 *
 * Duplicate `eventId`s are dropped: `fetch.ts` already dedupes a single query,
 * but rankings are also run over notes merged from several fetches, and the
 * same argument appearing twice would waste a slot in the top list.
 */
export function rankNotes(
  notes: readonly RankableNote[],
  opts: RankOptions = {},
): ScoredNote[] {
  if (!Array.isArray(notes) || notes.length === 0) return [];

  // Resolve the clock once so every note in a run is scored against the same
  // instant — otherwise ordering could drift mid-sort.
  const shared: RankOptions = {
    now: resolveNow(opts.now),
    halfLifeDays: positiveNumber(opts.halfLifeDays, DEFAULT_HALF_LIFE_DAYS),
  };

  const seen = new Set<string>();
  const scored: ScoredNote[] = [];
  for (const note of notes) {
    if (!note || typeof note !== "object") continue;
    const id = typeof note.eventId === "string" ? note.eventId : "";
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    scored.push(scoreNote(note, shared));
  }

  scored.sort(compareScored);
  return scored;
}

/**
 * The best `perStance` notes for each of favour / against / neutral.
 *
 * Buckets are filled independently, so a lopsided BIP still yields the
 * strongest minority argument instead of burying it under the majority — which
 * is the whole point of showing "best case for" next to "best case against".
 * A stance nobody expressed comes back empty.
 */
export function topNotesByStance(
  notes: readonly RankableNote[],
  opts: TopNotesOptions = {},
): TopNotesByStance {
  const perStance = positiveInt(opts.perStance, DEFAULT_PER_STANCE);
  const maxPerAuthor = positiveInt(opts.maxPerAuthor, DEFAULT_MAX_PER_AUTHOR);
  const minConfidence = threshold(opts.minConfidence, DEFAULT_MIN_CONFIDENCE);

  const grouped: TopNotesByStance = { favour: [], against: [], neutral: [] };
  for (const scored of rankNotes(notes, opts)) {
    if (confidenceScore(scored.note?.confidence) < minConfidence) continue;
    grouped[normaliseStance(scored.note?.stance)].push(scored);
  }

  const top: TopNotesByStance = { favour: [], against: [], neutral: [] };
  for (const stance of STANCES) {
    top[stance] = pickDiverse(grouped[stance], perStance, maxPerAuthor);
  }
  return top;
}

/**
 * Take the best notes from an already-sorted bucket while limiting how many can
 * come from one pubkey, so a single prolific author cannot present themselves
 * as the whole "for" or "against" case.
 *
 * If the cap leaves empty slots (a bucket where two people did all the
 * talking), we backfill with the notes it excluded: a second note from the same
 * author is still more useful to a reader than a blank slot. The result is
 * re-sorted so the display order stays strictly best-first.
 */
function pickDiverse(
  candidates: readonly ScoredNote[],
  limit: number,
  maxPerAuthor: number,
): ScoredNote[] {
  const picked: ScoredNote[] = [];
  const excluded: ScoredNote[] = [];
  const perAuthor = new Map<string, number>();

  for (const candidate of candidates) {
    if (picked.length >= limit) break;
    const author = authorKey(candidate);
    const used = perAuthor.get(author) ?? 0;
    if (used >= maxPerAuthor) {
      excluded.push(candidate);
      continue;
    }
    perAuthor.set(author, used + 1);
    picked.push(candidate);
  }

  for (const candidate of excluded) {
    if (picked.length >= limit) break;
    picked.push(candidate);
  }

  picked.sort(compareScored);
  return picked;
}

/** Log-saturating 0..1 curve. Missing, negative and junk values score 0. */
function saturating(value: number | undefined, saturationPoint: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return clamp01(Math.log1p(value) / Math.log1p(saturationPoint));
}

function recencyScore(
  createdAt: number,
  now: number,
  halfLifeDays: number,
): number {
  if (!Number.isFinite(createdAt)) return UNKNOWN_RECENCY;

  const ageSeconds = now - createdAt;
  // Future-dated notes mean clock skew or a lying relay, not relevance. Treat
  // them as brand new rather than letting a bad timestamp win the ranking.
  if (ageSeconds <= 0) return 1;

  return clamp01(Math.pow(0.5, ageSeconds / 86_400 / halfLifeDays));
}

/** See `FALLBACK_CONFIDENCE` for why a zero is read as "not reported". */
function confidenceScore(confidence: number): number {
  if (!Number.isFinite(confidence) || confidence <= 0) {
    return FALLBACK_CONFIDENCE;
  }
  return clamp01(confidence);
}

/**
 * Ties are broken by recency, then by `eventId`, so repeated runs over the same
 * data always produce the same order — a list that reshuffles itself between
 * page loads reads as broken.
 */
function compareScored(a: ScoredNote, b: ScoredNote): number {
  if (b.score !== a.score) return b.score - a.score;

  const aTime = Number.isFinite(a.note?.createdAt) ? a.note.createdAt : 0;
  const bTime = Number.isFinite(b.note?.createdAt) ? b.note.createdAt : 0;
  if (bTime !== aTime) return bTime - aTime;

  const aId = String(a.note?.eventId ?? "");
  const bId = String(b.note?.eventId ?? "");
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/**
 * Notes with no pubkey are keyed by event id, so a batch of anonymous or
 * malformed notes is not mistaken for one very talkative author.
 */
function authorKey(scored: ScoredNote): string {
  const pubkey = scored.note?.pubkey;
  if (typeof pubkey === "string" && pubkey.length > 0) return pubkey;
  return `anon:${String(scored.note?.eventId ?? Math.random())}`;
}

/** Anything the classifier returns that we do not recognise reads as neutral. */
function normaliseStance(stance: Stance | undefined): Stance {
  return stance === "favour" || stance === "against" ? stance : "neutral";
}

function resolveNow(now: number | undefined): number {
  if (typeof now !== "number" || !Number.isFinite(now)) {
    return Math.floor(Date.now() / 1000);
  }
  return now;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function positiveInt(value: number | undefined, fallback: number): number {
  return Math.floor(positiveNumber(value, fallback));
}

/** Thresholds differ from `positiveNumber`: an explicit 0 means "no filter". */
function threshold(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
