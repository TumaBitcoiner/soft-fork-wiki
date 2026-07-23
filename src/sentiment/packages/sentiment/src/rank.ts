/**
 * Rank classified notes and pick the strongest point of view per stance.
 *
 * The product question is "what are the best arguments for and against BIP N?",
 * not "who posted last". Reverse-chronological ordering answers the second
 * question, so instead we score every note and surface the top few in each
 * stance bucket — giving the UI a balanced "best case for / best case against /
 * best neutral read".
 *
 * ## What `confidence` is, and what it is not
 *
 * `ClassifiedNote.confidence` is easy to misread as a quality score. It is not.
 * `providers/prompt.ts` asks the model for "the author's stance, a confidence
 * from 0 to 1" — certainty about *which label applies*, nothing else. A note
 * saying "ACK" is trivially classifiable, so it scores high confidence while
 * containing no argument at all. Treating that number as quality actively
 * rewards filler: the emptier the note, the easier the label.
 *
 * So confidence is used here only as a *trust filter* on the stance bucket. A
 * note the classifier was unsure about is probably filed under the wrong
 * stance, and a misfiled note in a "best case against" list is worse than an
 * empty slot. Above the trust threshold, extra confidence earns nothing.
 *
 * ## What actually ranks a note
 *
 * Substance, multiplicatively. A note with no argument has no business being
 * the best case for anything, so substance gates the score rather than
 * competing with other terms — no amount of freshness or classifier certainty
 * can lift a contentless note over a reasoned one.
 *
 * Recency is a small multiplicative lift that can only reorder notes of
 * comparable substance (see `RECENCY_LIFT`).
 *
 * ## What we cannot measure yet
 *
 * Engagement is the signal we want — a note the network reacted to or zapped is
 * a note the network itself rated, which beats any heuristic here — but nothing
 * collects it: `fetch.ts` queries kind:1 notes only and never touches NIP-25
 * reactions (kind:7) or NIP-57 zap receipts (kind:9735). Rather than pretend,
 * `EngagementSignals` is optional, `undefined` for every note today, and
 * contributes exactly zero. Populating it during fetch is the one change needed
 * to switch real crowd signal on.
 */
import type { ClassifiedNote, Stance } from "@soft-fork-wiki/shared";

/**
 * Crowd signals for a single note.
 *
 * NOT WIRED YET — see the module comment. Every field is optional so a caller
 * can supply whichever signal it manages to collect first (reactions are the
 * cheapest, zaps are the most meaningful) without waiting for the full set.
 */
export interface EngagementSignals {
  /** NIP-25 reactions (kind:7) pointing at this note. */
  reactions?: number;
  /** Replies to this note (kind:1 carrying an `e` tag). */
  replies?: number;
  /** Total sats zapped to this note (NIP-57, kind:9735 receipts). */
  zapSats?: number;
}

/** A classified note plus whatever crowd signal we have collected for it. */
export interface RankableNote extends ClassifiedNote {
  engagement?: EngagementSignals;
}

/**
 * The raw 0..1 signals behind a score, before they are combined.
 *
 * Exposed because "why is this the top argument?" is a fair question from the
 * UI, and because it makes the combination tunable without re-deriving
 * anything. See `scoreNote` for how they multiply.
 */
export interface ScoreComponents {
  /** Substance of the note text. The dominant term. */
  substance: number;
  /** Trust in the stance label, after the missing-value fallback. */
  confidence: number;
  /** Recency, decayed by half-life. Only ever a small lift. */
  recency: number;
  /** Crowd signal. Always 0 until engagement is wired. */
  engagement: number;
}

export interface ScoredNote {
  note: RankableNote;
  /** 0..~1.1 today; up to ~1.5 once engagement is populated. */
  score: number;
  components: ScoreComponents;
}

export interface RankOptions {
  /**
   * Unix seconds treated as "now". The caller supplies it (as `summarize.ts`
   * does with `computedAt`) so a ranking is reproducible and testable.
   */
  now?: number;
  /** Days after which the recency lift halves. */
  halfLifeDays?: number;
}

export interface TopNotesOptions extends RankOptions {
  /** How many notes to return per stance. */
  perStance?: number;
  /** Cap on notes from one pubkey within a single stance bucket. */
  maxPerAuthor?: number;
  /** Exclude notes the classifier was less sure about than this. */
  minConfidence?: number;
  /** Exclude notes carrying less argument than this. */
  minSubstance?: number;
}

/** Best notes per stance. All three keys always exist, possibly empty. */
export type TopNotesByStance = Record<Stance, ScoredNote[]>;

/**
 * Recency multiplies the score by at most 1.10, so it can only reorder notes
 * whose substance is within ~9% of each other (1 / 1.10 = 0.909). Any material
 * difference in substance survives any difference in age — a six-month-old
 * argument outranks a shallower one posted this morning, which is the entire
 * reason we rank instead of sorting by `createdAt`.
 */
const RECENCY_LIFT = 0.1;

/**
 * A month keeps a whole cycle of discussion roughly comparable, which matters
 * because BIP debate has a long tail — the argument from the original
 * mailing-list thread is often still the best one.
 */
const DEFAULT_HALF_LIFE_DAYS = 30;

/**
 * At or above this confidence the stance label is taken at face value and no
 * damping applies. Deliberately flat above the threshold: a 0.95 label is not a
 * better *argument* than a 0.6 label, only a more certain filing.
 */
const CONFIDENCE_TRUSTED = 0.5;

/**
 * Below this the label is not trustworthy enough to show under a stance
 * heading. This is the same number as `DEFAULT_MIN_CONFIDENCE` on purpose:
 * filtering and damping are one mechanism, not two knobs that can drift apart.
 */
const CONFIDENCE_MIN_TRUST = 0.35;

/**
 * Multiplier for a note that fails the trust threshold. Flat rather than a
 * ramp — there is no meaningful ordering *among* labels we do not believe.
 * `topNotesByStance` drops these outright; this only affects callers using
 * `rankNotes` directly.
 */
const CONFIDENCE_UNTRUSTED_DAMP = 0.25;

/**
 * Multiplier at the trust threshold, ramping to 1 at `CONFIDENCE_TRUSTED`.
 * Held close to 1 deliberately: across every note that survives filtering,
 * confidence can shift a score by at most 1/0.85 = 1.18x. That keeps it a
 * nudge between comparable notes rather than a ranking term competing with
 * substance — which is the whole point, given confidence measures label
 * certainty and not argument quality.
 */
const CONFIDENCE_MARGINAL_DAMP = 0.85;

/**
 * Used when the classifier reported no usable confidence — a note is not worse
 * for a field the provider omitted.
 *
 * Note this deliberately also covers an exact `0`. `parseStanceJson` in
 * providers/prompt.ts does `Number(obj.confidence) || 0`, which collapses
 * "field absent", "unparseable" and "NaN" all into `0`. A model that has just
 * committed to a stance essentially never volunteers 0.0, so an exact zero is
 * far more likely to be that coercion than a real self-report. Reading it as
 * maximal distrust would silently delete every note from a provider whose JSON
 * hiccuped.
 */
const FALLBACK_CONFIDENCE = 0.5;

/** Used when `createdAt` is unusable: neither reward nor punish the note. */
const UNKNOWN_RECENCY = 0.5;

/** Distinct-word count beyond which extra words stop earning score. */
const SUBSTANCE_SATURATION_WORDS = 60;

/** Below this, a note is a reaction ("nack", "gm"), not a point of view. */
const MIN_POV_WORDS = 4;

/**
 * Engagement stays additive on top of the gated base, so that turning it on
 * later cannot silently rescale scores for notes that still lack it.
 *
 * KNOWN TENSION for whoever wires this up: because it is additive, it is the
 * one path by which a contentless note could climb a bucket ("gm" with 500
 * reactions). That is arguably right — the crowd rating a note beats our
 * heuristic reading of it — but if it proves wrong in practice, multiply this
 * term by `components.substance` too rather than shrinking the constant.
 */
const WEIGHT_ENGAGEMENT = 0.4;

/** Counts at which each engagement signal has earned most of its credit. */
const REACTION_SATURATION = 25;
const REPLY_SATURATION = 10;
const ZAP_SAT_SATURATION = 10_000;

const DEFAULT_PER_STANCE = 3;

/**
 * One note per author by default: three slots should mean three voices. The cap
 * is relaxed only as a last resort, when a bucket would otherwise sit half
 * empty (see `pickDiverse`).
 */
const DEFAULT_MAX_PER_AUTHOR = 1;

/**
 * Selection thresholds. A misfiled note, or a contentless one presented as "the
 * best case against", is worse than a short list — so both are excluded
 * outright rather than merely ranked low.
 *
 * The substance floor is set just above a single distinct word (0.042), so it
 * removes "gm" and "ACK ACK ACK..." while keeping terse but real positions like
 * "NACK, breaks existing wallets" (0.392).
 */
const DEFAULT_MIN_CONFIDENCE = CONFIDENCE_MIN_TRUST;
const DEFAULT_MIN_SUBSTANCE = 0.08;

const STANCES: readonly Stance[] = ["favour", "against", "neutral"];

/** Things that carry no argument and should not count towards substance. */
const URL_PATTERN = /https?:\/\/\S+/gi;
const NOSTR_REF_PATTERN =
  /(?:nostr:)?(?:npub|note|nevent|nprofile|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+/gi;
const HASHTAG_PATTERN = /(?:^|\s)#[\w-]+/g;

/**
 * Scripts written without spaces between words. Splitting these on whitespace
 * yields one enormous "word", which made a full Japanese or Chinese argument
 * measure as less substantial than a four-word English one (0.253 vs 0.659 on
 * equivalent text) — i.e. we were quietly ranking non-Latin scripts out of
 * "best point of view" on a global network. Their characters are counted as
 * sub-word units instead.
 */
const SCRIPTLESS_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/gu;

/** Rough morphemes per word in those scripts. */
const SCRIPTLESS_CHARS_PER_WORD = 2;

/**
 * Score one note.
 *
 *   score = substance x recencyLift x confidenceDamping + engagement
 *
 * Substance leads and the other two only scale it, so the ordering question is
 * always "which note argues more", with age and label-trust breaking ties.
 *
 * Never throws: every field is treated as untrusted, because `confidence`,
 * `createdAt` and `content` all originate from an LLM response or a relay we do
 * not control.
 */
export function scoreNote(
  note: RankableNote,
  opts: RankOptions = {},
): ScoredNote {
  const now = resolveNow(opts.now);
  const halfLifeDays = positiveNumber(opts.halfLifeDays, DEFAULT_HALF_LIFE_DAYS);

  const components: ScoreComponents = {
    substance: substanceScore(
      typeof note?.content === "string" ? note.content : "",
    ),
    confidence: confidenceScore(note?.confidence),
    recency: recencyScore(note?.createdAt, now, halfLifeDays),
    engagement: engagementScore(note?.engagement),
  };

  const gated =
    components.substance *
    (1 + RECENCY_LIFT * components.recency) *
    confidenceDamping(components.confidence);

  const score = gated + WEIGHT_ENGAGEMENT * components.engagement;

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
 * A stance nobody expressed comes back empty, as does one where every note was
 * filler; an empty slot is more honest than promoting "ACK" to headline
 * argument.
 */
export function topNotesByStance(
  notes: readonly RankableNote[],
  opts: TopNotesOptions = {},
): TopNotesByStance {
  const perStance = positiveInt(opts.perStance, DEFAULT_PER_STANCE);
  const maxPerAuthor = positiveInt(opts.maxPerAuthor, DEFAULT_MAX_PER_AUTHOR);
  const minConfidence = threshold(opts.minConfidence, DEFAULT_MIN_CONFIDENCE);
  const minSubstance = threshold(opts.minSubstance, DEFAULT_MIN_SUBSTANCE);

  const grouped: TopNotesByStance = { favour: [], against: [], neutral: [] };
  for (const scored of rankNotes(notes, opts)) {
    if (scored.components.confidence < minConfidence) continue;
    if (scored.components.substance < minSubstance) continue;
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

/**
 * How much argument a note carries, 0..1. The dominant ranking term.
 *
 * Length is measured in *distinct* meaningful words, which is the repetition
 * penalty: "ACK ACK ACK ... ACK" counts as one word, not sixteen, and so scores
 * like the one-word note it really is. That is cheaper and less arbitrary than
 * a separate variety multiplier with a floor, and it degrades gracefully — a
 * long note that merely reuses stopwords loses only those repeats.
 *
 * Growth is logarithmic, so a 600-word essay is not worth ten times a tight
 * 60-word argument; past saturation, more words earn nothing. Below
 * `MIN_POV_WORDS` a ramp (not a hard cutoff) takes over, so "NACK, breaks
 * existing wallets" is not treated the same as "nack".
 *
 * URLs, hashtags and nostr references are stripped first: "#bip110 <link>" is a
 * pointer, not an opinion, and should not read as a long note.
 */
function substanceScore(content: string): number {
  const distinct = distinctUnits(content);
  if (distinct === 0) return 0;

  const length = clamp01(
    Math.log1p(distinct) / Math.log1p(SUBSTANCE_SATURATION_WORDS),
  );
  const brevityFactor = Math.min(1, distinct / MIN_POV_WORDS);

  return clamp01(length * brevityFactor);
}

/**
 * Count the distinct meaningful units in a note: whitespace-delimited words,
 * plus an estimate for scripts that do not delimit words (see
 * `SCRIPTLESS_PATTERN`). Scriptless characters are removed before word
 * splitting so the two paths cannot double-count the same run of text.
 *
 * Distinctness is applied to both paths, so repetition earns nothing either
 * way: "ACK ACK ACK..." is one unit, and so is the same character repeated
 * twenty times.
 */
function distinctUnits(content: string): number {
  const stripped = content
    .replace(URL_PATTERN, " ")
    .replace(NOSTR_REF_PATTERN, " ")
    .replace(HASHTAG_PATTERN, " ")
    .toLowerCase();

  const scriptlessChars = new Set(stripped.match(SCRIPTLESS_PATTERN) ?? []).size;
  const words = new Set(
    stripped
      .replace(SCRIPTLESS_PATTERN, " ")
      .split(/[^\p{L}\p{N}'-]+/u)
      .filter((w) => w.length > 0),
  ).size;

  return words + Math.round(scriptlessChars / SCRIPTLESS_CHARS_PER_WORD);
}

/**
 * Exponential decay on a half-life, consumed only as a small multiplicative
 * lift — see `RECENCY_LIFT` for the bound on how much it can reorder.
 */
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

  const ageDays = ageSeconds / 86_400;
  return clamp01(Math.pow(0.5, ageDays / halfLifeDays));
}

/**
 * Confidence as trust in the *stance label*, never as quality — see the module
 * comment.
 *
 * Three regions, not a smooth curve: trusted (no effect), marginal (a nudge of
 * at most 1.18x, `CONFIDENCE_MARGINAL_DAMP`), and untrusted (a cliff, because a
 * note in the wrong bucket misrepresents the debate and does not deserve to be
 * ranked among notes that belong there).
 */
function confidenceDamping(confidence: number): number {
  if (confidence >= CONFIDENCE_TRUSTED) return 1;
  if (confidence < CONFIDENCE_MIN_TRUST) return CONFIDENCE_UNTRUSTED_DAMP;

  const span = CONFIDENCE_TRUSTED - CONFIDENCE_MIN_TRUST;
  const position = (confidence - CONFIDENCE_MIN_TRUST) / span;
  return CONFIDENCE_MARGINAL_DAMP + (1 - CONFIDENCE_MARGINAL_DAMP) * position;
}

/**
 * Crowd signal. Returns 0 for every note today — nothing populates
 * `EngagementSignals` yet — and exists so the wiring has a defined shape to
 * land in.
 *
 * Each signal saturates logarithmically: one loud note should not permanently
 * own the top slot, and the interesting difference is between 0 and 10
 * reactions, not between 100 and 110. Zaps carry the largest share because they
 * cost the sender something and are the hardest signal to fake.
 */
function engagementScore(engagement?: EngagementSignals): number {
  if (!engagement || typeof engagement !== "object") return 0;

  const reactions = saturating(engagement.reactions, REACTION_SATURATION);
  const replies = saturating(engagement.replies, REPLY_SATURATION);
  const zaps = saturating(engagement.zapSats, ZAP_SAT_SATURATION);

  return clamp01(0.35 * reactions + 0.2 * replies + 0.45 * zaps);
}

function saturating(value: number | undefined, saturationPoint: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return clamp01(Math.log1p(value) / Math.log1p(saturationPoint));
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
