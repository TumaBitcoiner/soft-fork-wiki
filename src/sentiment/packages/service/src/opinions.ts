/**
 * Read the *vote* side of a BIP off Nostr and fold it into an `OpinionTally`.
 *
 * The sentiment package only reads discussion, and a `SentimentSummary` has no
 * notion of votes or sats. All three vote mechanisms live on separate events —
 * NIP-88 poll responses, app-tagged opinion notes, and NIP-57 zap receipts — so
 * we fetch each here and let `tallyOpinions` do the arithmetic, keeping the
 * counting rules in one place.
 *
 * This is now the WHOLE input to the default (`zaps`) sentiment mode, not just a
 * side dish next to an LLM run, so three things changed:
 *
 *  1. **Every read is on a clock.** `fetchOpinionSignals` takes one wall-clock
 *     budget and spends it across both hops (see `relays.ts`). A wedged relay
 *     costs us partial data and a `degraded: true`, not the response time.
 *
 *  2. **Zap receipts are verified before they count.** `parseZapReceipt` only
 *     reports what a receipt *claims*; when sats drive the gauge, an unverified
 *     receipt is a stuffed ballot. Receipts now go through `zaptrust.ts`, which
 *     defaults to the same NIP-57 `"lnurl"` policy `sentiment/engagement.ts`
 *     documents. Rejections are reported, never silently dropped.
 *
 *  3. **Zap discovery no longer trusts `#t` alone.** NIP-57 requires a receipt
 *     to carry the `p` tag and the optional `e` tag from the zap request — it
 *     does NOT require the request's `t` tags to be copied, and most LN
 *     providers do not copy them. A `#t: ["bip300"]` filter on kind:9735
 *     therefore misses real votes. We keep that filter (some providers do copy
 *     the tags, and it costs one parallel subscription) and add the reliable
 *     route: `#e` against the ids we already know — our poll for the BIP and
 *     the opinion notes — since `buildZapRequest` stamps an `e` tag on the
 *     anchor being zapped.
 *
 * Never throws. Sentiment is the payload the demo is built on; a relay refusing
 * a subscription must degrade the counters to zero, not 502 the request.
 */
import {
  APP_TAG,
  NOSTR_KINDS,
  bipHashtag,
  type ClassifiedNote,
  type Opinion,
  type OpinionTally,
} from "@soft-fork-wiki/shared";
import {
  parseOpinion,
  parsePollResponse,
  tallyOpinions,
} from "@soft-fork-wiki/voting";
import type { ZapTrust } from "@soft-fork-wiki/sentiment";
import type { Event, Filter } from "nostr-tools";
import type { StanceCounts } from "./adapter.js";
import {
  Deadline,
  readRelays,
  relayList,
  type RelayReadResult,
} from "./relays.js";
import { verifyZapOpinions, type ZapVerification } from "./zaptrust.js";

export interface FetchTallyOptions {
  relays?: string[];
  /** Max events to pull per kind. */
  limit?: number;
  /**
   * Wall-clock budget for ALL relay reads in this call. The zap path lives or
   * dies on this number: it is the ceiling on how long `GET /sentiment/:bip`
   * can take once the sockets are warm.
   */
  budgetMs?: number;
  /** Zap receipt policy. Defaults to `"lnurl"`. See `zaptrust.ts`. */
  zapTrust?: ZapTrust;
  /** Per-request budget for an LNURL-pay endpoint fetch. */
  lnurlTimeoutMs?: number;
}

const DEFAULT_LIMIT = 500;

/**
 * Default wall-clock budget for all relay reads in one call.
 *
 * MEASURED, not guessed. On the default relay set an app-tag `#t` filter is
 * answered by nostr.wine, relay.primal.net and nos.lol in 50-280ms; relay
 * .damus.io takes 1.8-4.4s to EOSE and (per `shared/nostr.ts`) returns nothing
 * for `#t` filters anyway. 1.5s leaves the three useful relays a wide margin
 * and refuses to let the fourth set the product's response time.
 */
export const DEFAULT_BUDGET_MS = 1_500;

/**
 * Share of the budget hop one may spend.
 *
 * Hop two cannot start until hop one names the poll and the notes, so if hop
 * one is allowed the whole budget a slow relay there silently deletes the poll
 * responses. Half each, with hop two inheriting anything hop one returned early.
 */
const HOP1_SHARE = 0.5;

/**
 * Share of what is LEFT that hop two may spend, keeping a slice back for the
 * LNURL lookups in `zaptrust.ts` — those only run when somebody actually
 * zapped, which is exactly the moment the answer matters most.
 */
const HOP2_SHARE = 0.7;

/** How many poll events we will consider for one BIP. There should be one. */
const MAX_POLLS = 20;

/**
 * Cap on ids in one `#e` filter. Relays cap tag-filter cardinality and answer
 * an oversized filter with a silently truncated set, which would read as "these
 * notes got no zaps".
 */
const MAX_E_IDS = 50;

/** An all-zero tally, built through `tallyOpinions` so the shape can't drift. */
export function emptyTally(bipNumber: number): OpinionTally {
  return tallyOpinions(bipNumber, []);
}

/** Everything the zaps-and-votes gauge needs, with its own audit trail. */
export interface OpinionSignals {
  /**
   * All three mechanisms folded together: stance counts, `uniqueVoters`
   * deduplicated by pubkey across mechanisms, and the two sats totals.
   */
  tally: OpinionTally;
  /**
   * Stance counts from FREE votes only — poll responses and opinion notes, no
   * zaps. This is the headcount half of the display, deliberately kept apart
   * from the money half so the two can be shown side by side and disagree.
   */
  freeCounts: StanceCounts;
  /** Free votes that carried text, newest first, for `recentNotes`. */
  notes: ClassifiedNote[];
  /** What happened to the zap receipts we saw. */
  zaps: ZapVerification;
  /**
   * True only when NOT ONE relay completed a read, i.e. these numbers are not
   * backed by any full view and the zeros mean nothing.
   *
   * Deliberately not "some relay was slow": with the default relay set that is
   * true on almost every request (relay.damus.io needs seconds to EOSE on a
   * `#t` filter), and a flag that is always on is a flag nobody reads. Nostr
   * has no global truth anyway — a result confirmed by one relay is a real
   * result. `relays` vs `relaysAnswered` carries the finer story.
   */
  degraded: boolean;
  /** Measured wall time of the whole read, in milliseconds. */
  elapsedMs: number;
  /** Relays actually queried, so a surprising result is traceable. */
  relays: string[];
  /** Relays that reached EOSE on every read they were given. */
  relaysAnswered: string[];
}

/** An empty signal set, for the "nobody has weighed in" and disaster cases. */
export function emptySignals(
  bipNumber: number,
  opts: FetchTallyOptions = {},
  degraded = false,
): OpinionSignals {
  return {
    tally: emptyTally(bipNumber),
    freeCounts: { favour: 0, against: 0, neutral: 0 },
    notes: [],
    zaps: {
      opinions: [],
      accepted: 0,
      rejected: 0,
      rejectedSats: 0,
      skipped: 0,
      trust: opts.zapTrust ?? "lnurl",
    },
    degraded,
    elapsedMs: 0,
    relays: relayList(opts.relays),
    relaysAnswered: [],
  };
}

/**
 * Read every vote signal for a BIP in (at most) two relay round trips.
 *
 * Hop 1 asks for the three things findable from a tag alone: opinion notes,
 * tag-visible zap receipts, and our poll. Hop 2 needs hop 1's ids: the poll's
 * responses, and the zap receipts anchored to the poll or to an opinion note.
 * Two hops rather than one is why the budget is sliced rather than spent
 * per-query — see `Deadline` in `relays.ts`.
 */
export async function fetchOpinionSignals(
  bipNumber: number,
  opts: FetchTallyOptions = {},
): Promise<OpinionSignals> {
  const startedAt = Date.now();
  const relays = relayList(opts.relays);
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const hashtag = bipHashtag(bipNumber);
  const deadline = Deadline.in(opts.budgetMs ?? DEFAULT_BUDGET_MS);

  try {
    // Filter on the APP tag, not the BIP hashtag, and narrow to the BIP in
    // memory. NIP-01 ANDs different tag keys but ORs values inside one, so
    // `"#t": ["bip110", "softforkwiki"]` would widen this to all BIP-110
    // chatter rather than narrow it. Of the two, the app tag is the selective
    // one — and it is also the one every vote-carrying event we publish is
    // required to have, so nothing is lost by keying on it.
    //
    // This is the single biggest latency lever on the route. MEASURED against
    // the default relays: `#t: ["bip110"]` returns 500 kind:1 events from
    // nos.lol in 2.35s and 310 from relay.damus.io in 2.64s, because BIP 110 is
    // busy; `#t: ["softforkwiki"]` returns only events this app produced. The
    // gauge does not care about chatter — that is the LLM path's job.
    //
    // Separate filters rather than one `kinds: [1, 1068, 9735]`: each kind has
    // its own parser, and a shared filter would make the per-kind limits fight
    // each other.
    const hop1: Filter[] = [
      { kinds: [NOSTR_KINDS.TEXT_NOTE], "#t": [APP_TAG], limit },
      { kinds: [NOSTR_KINDS.ZAP_RECEIPT], "#t": [APP_TAG], limit },
      { kinds: [NOSTR_KINDS.POLL], "#t": [APP_TAG], limit },
    ];
    const hop1Deadline = deadline.slice(HOP1_SHARE);
    const hop1Reads = await Promise.all(
      hop1.map((filter) => readRelays(filter, relays, hop1Deadline)),
    );
    const [noteRead, taggedZapRead, pollRead] = hop1Reads as [
      RelayReadResult,
      RelayReadResult,
      RelayReadResult,
    ];

    // A relay counts as "answered" only if it finished EVERY read it was given;
    // one truncated subscription is enough to make its contribution partial.
    const answered = new Set(relays);
    const recordIncomplete = (reads: readonly RelayReadResult[]): void => {
      for (const read of reads) {
        for (const url of read.incomplete) answered.delete(url);
      }
    };
    recordIncomplete(hop1Reads);

    // `parseOpinion` returns null for anything without our app tag, so organic
    // discussion is filtered out here — it belongs to the LLM pass, not the
    // vote count.
    const noteOpinions: Opinion[] = [];
    const notes: ClassifiedNote[] = [];
    for (const event of noteRead.events) {
      const opinion = safeParseOpinion(event);
      if (!opinion || opinion.bipNumber !== bipNumber) continue;
      noteOpinions.push(opinion);
      notes.push(toClassifiedNote(event, opinion));
    }

    // The query asked for our app's polls; this narrows them to THIS BIP,
    // which is the half of the pair the relay could not do for us.
    const pollIds = pollRead.events
      .filter((poll) => poll.tags.some((t) => t[0] === "t" && t[1] === hashtag))
      .slice(0, MAX_POLLS)
      .map((poll) => poll.id);

    // Ids a zap could have been anchored to. Poll first: it is the canonical
    // anchor, and the cap must not drop it in favour of chatter.
    const zapAnchors = [...new Set([...pollIds, ...notes.map((n) => n.eventId)])]
      .slice(0, MAX_E_IDS);

    const hop2: Filter[] = [];
    if (pollIds.length > 0) {
      hop2.push({
        kinds: [NOSTR_KINDS.POLL_RESPONSE],
        "#e": pollIds,
        limit,
      });
    }
    if (zapAnchors.length > 0) {
      hop2.push({ kinds: [NOSTR_KINDS.ZAP_RECEIPT], "#e": zapAnchors, limit });
    }
    const hop2Deadline = deadline.slice(HOP2_SHARE);
    const hop2Reads = await Promise.all(
      hop2.map((filter) => readRelays(filter, relays, hop2Deadline)),
    );
    recordIncomplete(hop2Reads);

    const responseEvents: Event[] = [];
    const anchoredReceipts: Event[] = [];
    for (let i = 0; i < hop2.length; i += 1) {
      const read = hop2Reads[i];
      if (!read) continue;
      if (hop2[i]?.kinds?.[0] === NOSTR_KINDS.POLL_RESPONSE) {
        responseEvents.push(...read.events);
      } else {
        anchoredReceipts.push(...read.events);
      }
    }

    const pollOpinions = foldPollResponses(
      bipNumber,
      responseEvents,
      new Set(pollIds),
    );

    // Receipts arrive from two routes and overlap by design; `verifyZapOpinions`
    // deduplicates by invoice, which is stronger than by event id.
    const zaps = await verifyZapOpinions(
      [...taggedZapRead.events, ...anchoredReceipts],
      bipNumber,
      {
        relays,
        deadline,
        trust: opts.zapTrust,
        lnurlTimeoutMs: opts.lnurlTimeoutMs,
      },
    );

    const freeOpinions = [...pollOpinions, ...noteOpinions];
    const tally = tallyOpinions(bipNumber, [...freeOpinions, ...zaps.opinions]);
    const freeTally = tallyOpinions(bipNumber, freeOpinions);

    return {
      tally,
      freeCounts: {
        favour: freeTally.favour,
        against: freeTally.against,
        neutral: freeTally.neutral,
      },
      notes: notes.sort((a, b) => b.createdAt - a.createdAt),
      zaps,
      degraded: answered.size === 0,
      elapsedMs: Date.now() - startedAt,
      relays,
      relaysAnswered: [...answered],
    };
  } catch (err) {
    // Belt and braces: `readRelays` already swallows relay failures, so getting
    // here means something structural broke. Zeros beat a 502 on stage.
    console.warn(`opinion signals failed for BIP ${bipNumber}:`, err);
    const empty = emptySignals(bipNumber, opts, true);
    return { ...empty, elapsedMs: Date.now() - startedAt };
  }
}

/**
 * Fetch poll responses, opinion notes, and verified zap receipts for a BIP,
 * and tally them into one `OpinionTally`.
 *
 * A person who votes in the poll *and* zaps contributes two `Opinion`s, so the
 * stance counts weight them twice — but `uniqueVoters`, which is what we
 * surface as `totalVotes`, deduplicates by pubkey and counts them once.
 *
 * Kept as the narrow entry point the LLM path uses; everything richer comes
 * from `fetchOpinionSignals`, which this delegates to.
 */
export async function fetchOpinionTally(
  bipNumber: number,
  opts: FetchTallyOptions = {},
): Promise<OpinionTally> {
  const signals = await fetchOpinionSignals(bipNumber, opts);
  return signals.tally;
}

/**
 * Apply NIP-88's "one vote per pubkey, latest wins" rule and return `Opinion`s.
 *
 * We do this rather than call `tallyPollResponses`, because that returns counts
 * and we need the pubkeys: `uniqueVoters` has to deduplicate someone who both
 * voted in the poll and zapped, and it can only do that if every mechanism
 * contributes `Opinion`s to a single tally.
 */
function foldPollResponses(
  bipNumber: number,
  events: readonly Event[],
  pollIds: ReadonlySet<string>,
): Opinion[] {
  const latestByPubkey = new Map<string, Opinion>();
  for (const event of events) {
    let parsed: ReturnType<typeof parsePollResponse>;
    try {
      parsed = parsePollResponse(event);
    } catch {
      continue;
    }
    // Re-check the poll id: `#e` also matches events that merely reply to the
    // poll thread.
    if (!parsed || !pollIds.has(parsed.pollId)) continue;

    const previous = latestByPubkey.get(parsed.pubkey);
    if (previous && previous.createdAt >= parsed.createdAt) continue;
    latestByPubkey.set(parsed.pubkey, {
      bipNumber,
      pubkey: parsed.pubkey,
      stance: parsed.stance,
      source: "poll",
      eventId: parsed.eventId,
      createdAt: parsed.createdAt,
    });
  }
  return [...latestByPubkey.values()];
}

/**
 * Present a stated opinion as a `ClassifiedNote` so it can reuse the adapter's
 * note formatting.
 *
 * `confidence: 1` is honest here rather than optimistic: the stance was not
 * inferred from prose, the author labelled it themselves with an `l` tag.
 */
function toClassifiedNote(event: Event, opinion: Opinion): ClassifiedNote {
  return {
    eventId: event.id,
    pubkey: event.pubkey,
    content: typeof event.content === "string" ? event.content : "",
    createdAt: event.created_at,
    stance: opinion.stance,
    confidence: 1,
    rationale: "stated by the author (NIP-32 stance label)",
  };
}

function safeParseOpinion(event: Event): Opinion | null {
  try {
    return parseOpinion(event);
  } catch {
    return null;
  }
}
