/**
 * Find public Nostr discussion about a given BIP.
 *
 * WHY THIS IS MORE THAN A TAG QUERY
 * ---------------------------------
 * The original implementation asked only for `{kinds:[1], "#t":["bip<N>"]}`.
 * Measured against live relays that turns out to sample a specific and biased
 * slice of the conversation: people who bother to type `#bip300` are mostly
 * *broadcasting* about a proposal, while people *arguing* about it almost never
 * reach for the hashtag. For BIP 300 the tag lane returned 113 events and the
 * NIP-50 keyword lane returned hundreds, with an overlap of 13 — two nearly
 * disjoint populations, so either lane alone biases the sentiment read. BIP 444
 * was worse: 4 tagged notes were driving the whole gauge.
 *
 * Long-form (NIP-23 `kind:30023`) is where the substantive analysis lives, and
 * it is essentially never hashtagged: `{kinds:[30023], "#t":["bip300"]}`
 * returned ZERO across every relay probed, while the same topic surfaced dozens
 * of long-form articles through keyword search. Long-form has to be chased
 * through search, not through tags.
 *
 * We therefore run three lanes in one pass and dedupe:
 *   1. `kind:1` by `#bip<N>` tag           (the original behaviour, kept)
 *   2. `kind:30023` by `#bip<N>` tag       (cheap, occasionally hits)
 *   3. NIP-50 `search` for `kind:1` and `kind:30023`, against search-capable
 *      relays ONLY (see SEARCH_RELAYS for why "only" is load-bearing)
 *
 * Nothing here throws on relay trouble. A dead, slow or hostile relay degrades
 * the result set; it must never fail the request.
 */
import { SimplePool, type Event, type Filter } from "nostr-tools";
import {
  DEFAULT_RELAYS,
  SEARCH_RELAYS,
  NOSTR_KINDS,
  bipHashtag,
} from "@soft-fork-wiki/shared";

/**
 * How a note entered the sample. Downstream can display this ("found via a
 * long-form article") or weight by it, and it lets us re-measure the tag/search
 * split later without redoing this analysis by hand.
 *
 * Precedence when a note qualifies for more than one lane: `longform` (any
 * `kind:30023`) > `tag` (carried the `#bip<N>` hashtag) > `search`. The three
 * buckets are therefore mutually exclusive and sum to the total.
 */
export type DiscoveryMethod = "tag" | "search" | "longform";

/**
 * A Nostr event plus provenance. Structurally still an `Event`, so every
 * existing consumer (classify.ts, rank.ts, engagement.ts) keeps working
 * unchanged and simply ignores the extra field.
 */
export interface DiscoveredNote extends Event {
  discovery: DiscoveryMethod;
}

export interface FetchOptions {
  /** General-purpose relays for tag lookups. Defaults to DEFAULT_RELAYS. */
  relays?: readonly string[];
  /**
   * Relays that implement NIP-50, for the keyword lane. Defaults to
   * SEARCH_RELAYS. Passing a relay here that does NOT implement NIP-50 will
   * poison the sample — see the SEARCH_RELAYS docs for the failure mode.
   */
  searchRelays?: readonly string[];
  /**
   * Extra keywords for the NIP-50 lane — the proposal's real name, which is
   * what people actually type: `"drivechain"`, `"OP_CHECKTEMPLATEVERIFY"`,
   * `"datacarrier"`. Callers already know the BIP title, so this is the cheap
   * high-value knob. We deliberately ship no per-BIP keyword table; it would
   * rot and it would live in the wrong package.
   *
   * Merged with number-derived defaults (`bip300`, `BIP-300`).
   *
   * Prefer distinctive multi-character names. SHORT ACRONYMS ARE DANGEROUS:
   * passing `"CTV"` for BIP 119 matched llama.cpp command-line flags (`-ctv
   * f16`) in unrelated articles, because three letters collide with everything.
   * `"OP_CHECKTEMPLATEVERIFY"` and `"OP_CTV"` do not.
   */
  searchTerms?: readonly string[];
  /** Max notes to request per individual relay filter. */
  limit?: number;
  /** Overall cap on returned notes, newest first. */
  maxNotes?: number;
  /** Only notes newer than this unix-seconds timestamp. */
  since?: number;
  /** Run the NIP-50 keyword lane. Default true. */
  includeSearch?: boolean;
  /** Run the `kind:30023` long-form lanes. Default true. */
  includeLongForm?: boolean;
  /**
   * Apply the relevance guard to keyword hits. Default true. Turning it off is
   * only sensible when you are measuring what the guard removes.
   */
  requireRelevance?: boolean;
  /** Per-filter wall clock budget in ms before we give up on a relay. */
  timeoutMs?: number;
}

/** Counts that make the shape of the sample auditable rather than a mystery. */
export interface FetchStats {
  /** Events returned by relays across all filters, before any dedupe. */
  rawEvents: number;
  /** Distinct notes after dedupe, before the relevance guard. */
  uniqueEvents: number;
  /** Kept notes per discovery lane. Sums to `notes.length`. */
  byMethod: Record<DiscoveryMethod, number>;
  /** Dropped by the relevance guard — reported, never silently swallowed. */
  droppedByRelevance: number;
  /** Dropped for having no usable text. */
  droppedEmpty: number;
  /** Superseded revisions of the same addressable long-form article. */
  droppedReplaced: number;
  /** Dropped because `maxNotes` was hit (oldest first). */
  droppedOverCap: number;
  /** Distinct ids that both the tag lane and the keyword lane returned. */
  tagSearchOverlap: number;
  /** The terms actually sent to the NIP-50 relays. */
  searchTerms: string[];
  /** Relay/filter failures, for logging. Never thrown. */
  relayErrors: string[];
}

export interface FetchResult {
  notes: DiscoveredNote[];
  stats: FetchStats;
}

const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_NOTES = 500;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Escape a caller-supplied term for safe embedding in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Default keyword terms derived from the number alone. Search relays tokenize,
 * so `"bip300"` and `"BIP-300"` genuinely retrieve different sets. We stop at
 * two: `"BIP 300"` as a phrase gets OR-tokenized by these relays into
 * `bip OR 300` and returned ~300 mostly-unrelated notes in testing — noise the
 * relevance guard then has to clean up. Two cheap terms plus caller-supplied
 * names is the better ratio.
 */
function defaultSearchTerms(bipNumber: number): string[] {
  return [`bip${bipNumber}`, `BIP-${bipNumber}`];
}

/**
 * Dedupe key.
 *
 * `kind:30023` is ADDRESSABLE (NIP-01 parameterized-replaceable, kinds
 * 30000-39999): editing and re-publishing an article produces a brand new event
 * id for the same piece of writing. Deduping long-form by `id` therefore counts
 * one article as many — we measured a single Bitcoin Magazine piece appearing
 * four times, and that inflation lands entirely in the long-form bucket where
 * the sample is smallest. Address them by `kind:pubkey:d-tag` and keep the
 * newest revision instead.
 */
function dedupeKey(e: Event): string {
  if (e.kind >= 30000 && e.kind < 40000) {
    const d = e.tags.find((t) => t[0] === "d")?.[1] ?? "";
    return `${e.kind}:${e.pubkey}:${d}`;
  }
  return e.id;
}

/**
 * Build the relevance guard.
 *
 * NIP-50 relays do fuzzy, tokenized matching, so a term like `"covenants"` or a
 * hyphenated `"BIP-119"` drags in notes with no connection to the proposal. The
 * guard requires a note to name the BIP number, or one of the supplied terms,
 * as a WHOLE WORD.
 *
 * TRADEOFF, stated plainly: this buys precision at the cost of recall. A note
 * that argues about the proposal purely by paraphrase ("that new sidechain soft
 * fork", "merge mining is not new") names neither the number nor a term and
 * WILL be dropped — we watched exactly that happen to on-topic BIP 300 replies.
 * That is the deliberate choice: a gauge computed from a noisy sample is worse
 * than one computed from a smaller clean sample, because the noise is not
 * random with respect to stance (generic Bitcoin chatter skews positive, and
 * off-topic notes classify as "not sure", dragging every gauge toward the
 * middle). The remedy for the recall loss is better `searchTerms` from the
 * caller, not a looser guard, and `stats.droppedByRelevance` is reported on
 * every call so the cost stays visible instead of vanishing.
 *
 * The guard is NOT a topic classifier: whole-word `datacarrier` matches
 * `datacarriersize` config chatter that is about the same argument but not
 * about BIP 444 as such. Precision here means "plausibly on subject", and the
 * LLM classifier downstream is the second filter.
 *
 * Notes carrying the `#bip<N>` hashtag bypass the guard entirely: an explicit
 * tag is a stronger relevance signal than any string match.
 */
function buildRelevance(
  bipNumber: number,
  terms: readonly string[],
): (e: Event) => boolean {
  // `bip300`, `BIP-300`, `bip 300`, `bip_300` — but not `bip3000`.
  const numberPattern = new RegExp(
    `(?<![a-z0-9])bip[\\s._\\-]{0,2}${bipNumber}(?![0-9])`,
    "i",
  );
  const termPatterns = terms
    .map((t) => t.trim())
    .filter((t) => t.length > 1)
    .map(
      (t) =>
        new RegExp(
          `(?<![\\w])${escapeRegExp(t).replace(/\s+/g, "\\s+")}(?![\\w])`,
          "i",
        ),
    );
  const hashtag = bipHashtag(bipNumber).toLowerCase();

  return (e: Event): boolean => {
    // An explicit hashtag is self-evidently on topic.
    for (const tag of e.tags) {
      if (tag[0] === "t" && tag[1]?.toLowerCase() === hashtag) return true;
    }
    // Long-form keeps its headline and abstract in tags, not in content.
    const meta = e.tags
      .filter((t) => t[0] === "title" || t[0] === "summary")
      .map((t) => t[1] ?? "")
      .join(" ");
    const haystack = `${e.content} ${meta}`;
    if (numberPattern.test(haystack)) return true;
    return termPatterns.some((p) => p.test(haystack));
  };
}

/**
 * One filter against one relay set, bounded and non-throwing.
 *
 * `querySync` already honours `maxWait`, but a relay that accepts the socket
 * and then goes quiet would still hang us, so we race an outer timer too and
 * funnel every failure into a string rather than an exception.
 */
async function safeQuery(
  pool: SimplePool,
  relays: readonly string[],
  filter: Filter,
  timeoutMs: number,
  errors: string[],
  label: string,
): Promise<Event[]> {
  if (relays.length === 0) return [];
  try {
    return await Promise.race([
      pool.querySync([...relays], filter, { maxWait: timeoutMs }),
      new Promise<Event[]>((resolve) =>
        setTimeout(() => resolve([]), timeoutMs + 2_000),
      ),
    ]);
  } catch (err) {
    errors.push(`${label}: ${String(err)}`);
    return [];
  }
}

function emptyStats(terms: string[], errors: string[]): FetchStats {
  return {
    rawEvents: 0,
    uniqueEvents: 0,
    byMethod: { tag: 0, search: 0, longform: 0 },
    droppedByRelevance: 0,
    droppedEmpty: 0,
    droppedReplaced: 0,
    droppedOverCap: 0,
    tagSearchOverlap: 0,
    searchTerms: terms,
    relayErrors: errors,
  };
}

/**
 * Full-fidelity discovery: the notes plus the stats describing how they were
 * found and what was thrown away. Use this when you care about provenance; use
 * `fetchBipNotes` when you just want the notes.
 */
export async function fetchBipNotesDetailed(
  bipNumber: number,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const relays = [...(opts.relays ?? DEFAULT_RELAYS)];
  const searchRelays = [...(opts.searchRelays ?? SEARCH_RELAYS)];
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const maxNotes = opts.maxNotes ?? DEFAULT_MAX_NOTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const includeSearch = opts.includeSearch ?? true;
  const includeLongForm = opts.includeLongForm ?? true;
  const requireRelevance = opts.requireRelevance ?? true;
  const hashtag = bipHashtag(bipNumber);

  // Caller terms first — they are the specific ones we most want relays to see.
  // Deduped case-insensitively.
  const terms: string[] = [];
  const seenTerm = new Set<string>();
  for (const t of [
    ...(opts.searchTerms ?? []),
    ...defaultSearchTerms(bipNumber),
  ]) {
    const trimmed = t.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seenTerm.has(key)) continue;
    seenTerm.add(key);
    terms.push(trimmed);
  }

  const errors: string[] = [];
  const pool = new SimplePool();
  const allRelays = [...new Set([...relays, ...searchRelays])];

  try {
    const base = { limit, since: opts.since };

    // Lanes 1+2: hashtag. Kinds are queried separately rather than as
    // `kinds:[1,30023]` because relays apply `limit` across the whole filter
    // and kind:1 vastly outnumbers long-form — a combined filter would crowd
    // long-form out of the window entirely.
    const tagJobs: Array<Promise<Event[]>> = [
      safeQuery(
        pool,
        relays,
        { ...base, kinds: [NOSTR_KINDS.TEXT_NOTE], "#t": [hashtag] },
        timeoutMs,
        errors,
        "tag/kind1",
      ),
    ];
    if (includeLongForm) {
      tagJobs.push(
        safeQuery(
          pool,
          relays,
          { ...base, kinds: [NOSTR_KINDS.LONG_FORM], "#t": [hashtag] },
          timeoutMs,
          errors,
          "tag/longform",
        ),
        // Search relays index tags too; asking costs one extra round trip.
        safeQuery(
          pool,
          searchRelays,
          { ...base, kinds: [NOSTR_KINDS.LONG_FORM], "#t": [hashtag] },
          timeoutMs,
          errors,
          "tag/longform/searchrelays",
        ),
      );
    }

    // Lane 3: NIP-50 keyword, search-capable relays ONLY.
    const searchJobs: Array<Promise<Event[]>> = [];
    if (includeSearch && searchRelays.length > 0) {
      for (const term of terms) {
        searchJobs.push(
          safeQuery(
            pool,
            searchRelays,
            { ...base, kinds: [NOSTR_KINDS.TEXT_NOTE], search: term },
            timeoutMs,
            errors,
            `search/kind1/${term}`,
          ),
        );
        if (includeLongForm) {
          searchJobs.push(
            safeQuery(
              pool,
              searchRelays,
              { ...base, kinds: [NOSTR_KINDS.LONG_FORM], search: term },
              timeoutMs,
              errors,
              `search/longform/${term}`,
            ),
          );
        }
      }
    }

    const [tagResults, searchResults] = await Promise.all([
      Promise.all(tagJobs),
      Promise.all(searchJobs),
    ]);

    const tagEvents = tagResults.flat();
    const searchEvents = searchResults.flat();
    const rawEvents = tagEvents.length + searchEvents.length;

    const tagIds = new Set(tagEvents.map((e) => e.id));
    const searchIds = new Set(searchEvents.map((e) => e.id));
    let tagSearchOverlap = 0;
    for (const id of searchIds) if (tagIds.has(id)) tagSearchOverlap++;

    // Dedupe across every lane and relay, collapsing long-form revisions.
    const unique = new Map<string, Event>();
    const seenIds = new Set<string>();
    let droppedReplaced = 0;
    for (const e of [...tagEvents, ...searchEvents]) {
      if (seenIds.has(e.id)) continue; // same event echoed by another relay
      seenIds.add(e.id);
      const key = dedupeKey(e);
      const prev = unique.get(key);
      if (!prev) {
        unique.set(key, e);
        continue;
      }
      droppedReplaced++;
      if (e.created_at > prev.created_at) unique.set(key, e);
    }

    const isRelevant = buildRelevance(bipNumber, terms);
    let droppedByRelevance = 0;
    let droppedEmpty = 0;
    const kept: DiscoveredNote[] = [];

    for (const e of unique.values()) {
      if (!e.content.trim()) {
        droppedEmpty++;
        continue;
      }
      if (requireRelevance && !isRelevant(e)) {
        droppedByRelevance++;
        continue;
      }
      const discovery: DiscoveryMethod =
        e.kind === NOSTR_KINDS.LONG_FORM
          ? "longform"
          : tagIds.has(e.id)
            ? "tag"
            : "search";
      kept.push({ ...e, discovery });
    }

    // Newest first, then cap. A cap applied in arrival order would bias the
    // sample toward whichever relay answered fastest.
    kept.sort((a, b) => b.created_at - a.created_at);
    const droppedOverCap = Math.max(0, kept.length - maxNotes);
    const notes = kept.slice(0, maxNotes);

    const byMethod: Record<DiscoveryMethod, number> = {
      tag: 0,
      search: 0,
      longform: 0,
    };
    for (const n of notes) byMethod[n.discovery]++;

    return {
      notes,
      stats: {
        rawEvents,
        uniqueEvents: unique.size,
        byMethod,
        droppedByRelevance,
        droppedEmpty,
        droppedReplaced,
        droppedOverCap,
        tagSearchOverlap,
        searchTerms: terms,
        relayErrors: errors,
      },
    };
  } catch (err) {
    // Belt and braces: discovery degrades to empty, it never fails the caller.
    return {
      notes: [],
      stats: emptyStats(terms, [...errors, `fatal: ${String(err)}`]),
    };
  } finally {
    try {
      pool.close(allRelays);
    } catch {
      // Closing a socket that is already gone is not worth raising.
    }
  }
}

/**
 * Notes discussing a BIP. Signature unchanged — `pipeline.ts` and the service
 * keep calling `fetchBipNotes(bipNumber, opts)` — but the sample is now drawn
 * from tags, long-form and NIP-50 keyword search instead of tags alone.
 *
 * The return type gained a `discovery` field. It still satisfies `Event[]`, so
 * existing consumers are unaffected. Callers wanting the provenance counts
 * should use `fetchBipNotesDetailed`.
 */
export async function fetchBipNotes(
  bipNumber: number,
  opts: FetchOptions = {},
): Promise<DiscoveredNote[]> {
  const { notes } = await fetchBipNotesDetailed(bipNumber, opts);
  return notes;
}
