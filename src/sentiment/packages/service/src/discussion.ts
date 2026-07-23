/**
 * Phase 1's real signal: money on PUBLIC posts about a BIP.
 *
 * ## THE BUG THIS FIXES
 *
 * `opinions.ts` counts only events carrying our own `softforkwiki` tag. That is
 * the right definition of "a vote cast in this app" and it is also, today,
 * always zero — nobody has used the app yet. So `GET /sentiment/:bip?mode=zaps`
 * returned zeros for every BIP while real Lightning payments were sitting on
 * public Nostr posts arguing about those same proposals, in the tens of
 * thousands of sats. The gauge was reporting "no money" about a conversation
 * that had money in it.
 *
 * This module reads that money. `fetchBipNotes` already knows how to find posts
 * about a BIP (hashtag lane, NIP-50 keyword lane, long-form lane); `fetchEngagement`
 * already knows how to ask the relays what happened to a set of note ids and to
 * refuse zap receipts that cannot prove themselves. Wiring the two together is
 * the whole fix. Nothing is seeded, nothing is simulated.
 *
 * ## MAGNITUDE, NOT DIRECTION — AND THIS IS NOT NEGOTIABLE
 *
 * A zap on somebody's post means "this was worth paying for". It does NOT say
 * whether the post argued for or against the proposal. Splitting these sats into
 * FOR and AGAINST would require knowing what each post says, which is a
 * classification problem and belongs to `?mode=llm` — Phase 2. So this module
 * reports one honest number, "this much money is behind the discussion of this
 * BIP", and the payload sets `scoreBasis: "magnitude"` and `hasDirection: false`
 * so a UI cannot mistake it for a needle. See `adapter.ts`.
 *
 * ## TRUST STAYS ON
 *
 * `zapTrust` is passed straight through and defaults to `"lnurl"`: a receipt
 * counts only if it was signed by the `nostrPubkey` that the recipient's own
 * LNURL-pay endpoint advertises. That is the check that stops anyone buying the
 * top slot with a self-signed receipt for zero sats. Rejections are reported
 * (`rejected` / `rejectedSats`), never hidden. What we did for speed is cache
 * the lookups (`lnurlcache.ts`, `zaptrust.ts`), never skip them.
 *
 * ## SPEED
 *
 * MEASURED against live relays: discovery is ~5s (bounded by its own filter
 * timeout, all lanes in parallel) and engagement is ~9.5s cold / ~4.7s warm for
 * 300 posts, the difference being entirely LNURL round trips. Three things keep
 * that off the request path:
 *
 *  1. `lnurlcache.ts` memoises endpoint lookups process-wide for an hour, so
 *     the custodians that sign most receipts are resolved once for the whole
 *     demo, across every BIP.
 *  2. This module caches its own result per BIP for `ttlMs`, single-flight, so
 *     concurrent tabs and the 5-second vote-side refresh cycle do not re-run
 *     discovery. A degraded or empty read is cached only briefly, so a bad relay
 *     minute does not stick for the whole TTL.
 *  3. Everything is under one wall-clock budget. If a relay wedges, the read
 *     returns `degraded: true` with zeros rather than holding the response open.
 *
 * ## FAILURE
 *
 * Never throws. Relay trouble, a hostile response, a blown budget — all of them
 * degrade to zeros with `degraded: true`. Phase 1 must not be able to 500.
 */
import {
  fetchBipNotesDetailed,
  fetchEngagement,
  type DiscoveryMethod,
  type ZapTrust,
} from "@soft-fork-wiki/sentiment";
import { NOSTR_KINDS } from "@soft-fork-wiki/shared";
import type { Event, Filter } from "nostr-tools";
import { installLnurlCache } from "./lnurlcache.js";
import { safeMessage } from "./redact.js";
import { Deadline, readRelays, relayList } from "./relays.js";
import { countZapperIdentities } from "./zaptrust.js";

/** One post that drew sats, as facts. Presentation happens in `adapter.ts`. */
export interface TopPost {
  eventId: string;
  /** Hex pubkey of the author. The adapter abbreviates it to an npub. */
  pubkey: string;
  /** First line or so of the post, whitespace collapsed. */
  excerpt: string;
  /** Verified sats zapped to this post. */
  sats: number;
  /** Verified zap receipts on this post. */
  zaps: number;
  reactions: number;
  replies: number;
  createdAt: number;
  /** Which discovery lane found it: `tag`, `search` or `longform`. */
  discovery: DiscoveryMethod;
}

/** Everything Phase 1 learned about the money behind a BIP's discussion. */
export interface DiscussionSignals {
  /** Total VERIFIED sats zapped across the sampled posts. The headline number. */
  sats: number;
  /** Verified zap receipts behind `sats`. */
  zaps: number;
  /**
   * Distinct pubkeys that paid at least one verified zap. From the identity
   * pass in `zaptrust.ts`; see `zappersFrom` for its denominator.
   */
  zappers: number;
  /**
   * Receipts the identity pass verified. Reported next to `zappers` because the
   * two passes read the relays independently and can see slightly different
   * receipt sets; comparing this with `zaps` shows how far apart they were.
   */
  zappersFrom: number;
  /** NIP-25 positive reactions across the sample. */
  reactions: number;
  /** NIP-25 `"-"` reactions, kept apart from `reactions` (see engagement.ts). */
  downvotes: number;
  /** Replies across the sample. */
  replies: number;
  /** Posts discovered and measured. */
  posts: number;
  /** Posts that drew at least one verified zap. */
  postsZapped: number;
  /** The cap that was applied to `posts`. */
  postLimit: number;
  /** True when discovery found more posts than `postLimit` allowed. */
  truncated: boolean;
  /** How many posts the cap dropped (oldest first). Never silent. */
  postsDropped: number;
  /** Receipts refused by the trust policy. Non-zero on public relays is normal. */
  rejected: number;
  /** Sats those refused receipts claimed — the size of what was turned away. */
  rejectedSats: number;
  /** Receipts stating no amount we could read. */
  skipped: number;
  /** The policy applied. `"lnurl"` is the default and the only safe one. */
  trust: ZapTrust;
  /** True when relay trouble or the budget stopped us getting a real read. */
  degraded: boolean;
  /** Measured wall time of discovery + engagement, in milliseconds. */
  elapsedMs: number;
  /** When this read completed, epoch millis, so the payload can state its age. */
  computedAt: number;
  /** The posts that drew the most sats, richest first. */
  topPosts: TopPost[];
}

export interface DiscussionOptions {
  relays?: string[];
  /** Hard cap on posts measured. Also the per-filter relay limit. */
  postLimit: number;
  /** Wall-clock ceiling on the whole read. */
  budgetMs: number;
  /** How long a good result is reused. */
  ttlMs: number;
  /** Receipt validation policy. Never weakened for speed. */
  zapTrust: ZapTrust;
  /** Per-request budget for one LNURL-pay endpoint fetch. */
  lnurlTimeoutMs: number;
}

/** How many zapped posts we surface. Enough to show a leaderboard, not a feed. */
const TOP_POSTS = 5;

/** Longest post excerpt echoed back. */
const MAX_EXCERPT_CHARS = 200;

/**
 * Ids per `#e` filter in the identity pass. Matches `engagement.ts`: relays cap
 * tag-filter cardinality and answer an oversized filter with a silently
 * truncated set, which would read as "nobody zapped these".
 */
const CHUNK_SIZE = 50;

/** Chunks queried at once, bounded so we are not rate-limited off a relay. */
const CONCURRENCY = 4;

/** Ask for far more than a chunk could attract, so the cap is never the answer. */
const EVENTS_PER_QUERY = 2_000;

/**
 * Share of the budget discovery may spend, and share engagement may spend.
 *
 * Engagement cannot start until discovery names the ids, so the two are
 * sequential and must not each be allowed the whole budget. The remaining 20%
 * absorbs LNURL round trips on a cold cache, which are the part that overruns.
 */
const DISCOVERY_SHARE = 0.4;
const ENGAGEMENT_SHARE = 0.4;

/** Floor and ceiling on either phase, so an odd budget cannot produce nonsense. */
const MIN_PHASE_MS = 1_000;
const MAX_PHASE_MS = 8_000;

/**
 * Floor on the LNURL timeout for this path, overriding a tighter config value.
 *
 * MEASURED: at 2.5s (the vote path's default, chosen for a route with a 1.5s
 * relay budget) a cold run rejected essentially every public receipt — BIP 158
 * came back 0 accepted / 51 rejected — because custodial endpoints simply do not
 * answer that fast on a first contact. At 6s the same read accepted 23 receipts
 * worth 4,754 sats. Rejecting real money because we were impatient is not
 * "strict", it is wrong, and thanks to `lnurlcache.ts` this cost is paid once
 * per endpoint per hour rather than once per request.
 */
const MIN_DISCUSSION_LNURL_MS = 6_000;

/** How long a degraded or empty read is cached. Short: it deserves a retry. */
const NEGATIVE_TTL_MS = 20_000;

interface CacheEntry {
  value: DiscussionSignals;
  expiresAt: number;
}

const cached = new Map<number, CacheEntry>();
const inflight = new Map<number, Promise<DiscussionSignals>>();

export interface DiscussionCacheStats {
  entries: number;
  inflight: number;
}

export function discussionCacheStats(): DiscussionCacheStats {
  return { entries: cached.size, inflight: inflight.size };
}

/** Drop a cached read so the next request re-measures. Backs `?refresh=1`. */
export function invalidateDiscussion(bipNumber: number): void {
  cached.delete(bipNumber);
}

/** An all-zero read, for "nobody discussed this" and for every failure. */
export function emptyDiscussion(
  opts: DiscussionOptions,
  degraded = false,
): DiscussionSignals {
  return {
    sats: 0,
    zaps: 0,
    zappers: 0,
    zappersFrom: 0,
    reactions: 0,
    downvotes: 0,
    replies: 0,
    posts: 0,
    postsZapped: 0,
    postLimit: opts.postLimit,
    truncated: false,
    postsDropped: 0,
    rejected: 0,
    rejectedSats: 0,
    skipped: 0,
    trust: opts.zapTrust,
    degraded,
    elapsedMs: 0,
    computedAt: Date.now(),
    topPosts: [],
  };
}

/**
 * Cached, single-flight read of the money behind a BIP's discussion.
 *
 * Single-flight matters more here than in the response cache: discovery fans
 * out to eight relay filters and engagement to three per chunk, so two tabs
 * opening the same BIP at the same moment would double that traffic for no
 * extra information.
 *
 * A degraded or empty result is cached only for `NEGATIVE_TTL_MS`. Relay
 * availability on Nostr is genuinely intermittent — the same BIP returned 4
 * posts on one probe and 216 on the next — and a bad minute must not be able to
 * pin the demo to zeros for the whole TTL.
 */
export function loadDiscussionSignals(
  bipNumber: number,
  opts: DiscussionOptions,
): Promise<DiscussionSignals> {
  const hit = cached.get(bipNumber);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);

  const pending = inflight.get(bipNumber);
  if (pending) return pending;

  const run = fetchDiscussionSignals(bipNumber, opts)
    .then((value) => {
      const usable = !value.degraded && value.posts > 0;
      const ttl = usable ? opts.ttlMs : Math.min(opts.ttlMs, NEGATIVE_TTL_MS);
      if (ttl > 0) {
        cached.set(bipNumber, { value, expiresAt: Date.now() + ttl });
      }
      return value;
    })
    .finally(() => {
      inflight.delete(bipNumber);
    });

  inflight.set(bipNumber, run);
  return run;
}

/**
 * Do the work: find the posts, then ask the relays what the network paid for
 * them. Never throws; the overall budget is enforced with a race so that a
 * library that has no cancellation still cannot hold the response open.
 */
export async function fetchDiscussionSignals(
  bipNumber: number,
  opts: DiscussionOptions,
): Promise<DiscussionSignals> {
  // Idempotent, and cheap enough to do on every call rather than depending on
  // some other module having been imported first.
  installLnurlCache();

  const started = Date.now();
  const budget = Math.max(MIN_PHASE_MS, opts.budgetMs);
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const overBudget = new Promise<DiscussionSignals>((resolve) => {
      timer = setTimeout(
        () => resolve({ ...emptyDiscussion(opts, true), elapsedMs: budget }),
        budget,
      );
    });
    return await Promise.race([measure(bipNumber, opts, started), overBudget]);
  } catch (err) {
    // `fetchBipNotesDetailed` and `fetchEngagement` both promise not to throw,
    // so reaching here means something structural broke. Zeros beat a 502.
    console.warn(
      `discussion signals failed for BIP ${bipNumber}: ${safeMessage(err)}`,
    );
    return { ...emptyDiscussion(opts, true), elapsedMs: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function measure(
  bipNumber: number,
  opts: DiscussionOptions,
  started: number,
): Promise<DiscussionSignals> {
  const relays = relayList(opts.relays);
  const discoveryMs = phaseBudget(opts.budgetMs, DISCOVERY_SHARE);
  const engagementMs = phaseBudget(opts.budgetMs, ENGAGEMENT_SHARE);
  const lnurlTimeoutMs = Math.max(opts.lnurlTimeoutMs, MIN_DISCUSSION_LNURL_MS);

  // No `searchTerms`: this service has no per-BIP keyword table and `fetch.ts`
  // argues convincingly against shipping one (it would rot, and it belongs to
  // whoever knows the proposal's real name). The number-derived terms plus the
  // hashtag and long-form lanes are what we have, and the relevance guard in
  // `fetch.ts` keeps the sample clean.
  const { notes, stats } = await fetchBipNotesDetailed(bipNumber, {
    relays,
    limit: opts.postLimit,
    maxNotes: opts.postLimit,
    timeoutMs: discoveryMs,
  });

  if (notes.length === 0) {
    // Zero posts with relay errors is a failed read; zero posts from a clean
    // read is a real answer about an undiscussed proposal. Do not conflate them.
    return {
      ...emptyDiscussion(opts, stats.relayErrors.length > 0),
      elapsedMs: Date.now() - started,
    };
  }

  const ids = notes.map((note) => note.id);

  // The two passes ask different questions of the same ids, so they run
  // together rather than one after the other: wall time is one pass, and the
  // LNURL lookups they both need collapse onto one HTTPS request each thanks to
  // the single-flight memo in `lnurlcache.ts`.
  const [engagement, identities] = await Promise.all([
    fetchEngagement(ids, {
      relays,
      zapTrust: opts.zapTrust,
      chunkSize: CHUNK_SIZE,
      concurrency: CONCURRENCY,
      maxWaitMs: engagementMs,
      lnurlTimeoutMs,
    }),
    countZappers(ids, relays, engagementMs, opts, lnurlTimeoutMs),
  ]);

  const out: DiscussionSignals = {
    ...emptyDiscussion(opts),
    posts: notes.length,
    postsDropped: stats.droppedOverCap,
    truncated: stats.droppedOverCap > 0,
    zappers: identities.zappers,
    zappersFrom: identities.accepted,
    // `fetchEngagement` swallows relay failures and reports zeros, which is
    // right for it and dangerous for us: "nobody zapped these 210 posts" and
    // "every relay refused the query" would look identical. The zapper pass
    // reads the same relays for the same kind through `readRelays`, which DOES
    // report who answered, so we borrow its verdict. Measured against two dead
    // relays: 210 posts discovered (the search lane uses a different relay set
    // and still worked), 0 sats, and this flag correctly set.
    degraded: identities.reads > 0 && identities.answered === 0,
  };

  const scored: TopPost[] = [];
  for (const note of notes) {
    const signals = engagement.get(note.id);
    if (!signals) continue;
    out.sats += signals.zapSats;
    out.zaps += signals.zaps;
    out.reactions += signals.reactions;
    out.downvotes += signals.downvotes;
    out.replies += signals.replies;
    out.rejected += signals.zapsRejected;
    out.rejectedSats += signals.rejectedSats;
    out.skipped += signals.skipped;
    if (signals.zaps > 0) {
      out.postsZapped += 1;
      scored.push({
        eventId: note.id,
        pubkey: note.pubkey,
        excerpt: excerpt(note.content),
        sats: signals.zapSats,
        zaps: signals.zaps,
        reactions: signals.reactions,
        replies: signals.replies,
        createdAt: note.created_at,
        discovery: note.discovery,
      });
    }
  }

  scored.sort((a, b) => b.sats - a.sats || b.zaps - a.zaps);
  out.topPosts = scored.slice(0, TOP_POSTS);
  out.elapsedMs = Date.now() - started;
  out.computedAt = Date.now();
  return out;
}

/**
 * Read the zap receipts on these posts once more, only to learn WHO paid.
 *
 * `fetchEngagement` is the authority on how much moved, but it aggregates per
 * note and never exposes a payer, so it cannot answer "how many people is
 * that?". This pass exists solely for that count and hands the receipts to
 * `countZapperIdentities`, which applies the identical `"lnurl"` bar.
 *
 * It goes through `readRelays` rather than a fresh pool so it reuses the
 * process's warm sockets, and it is bounded by the same phase budget. A failure
 * costs us the zapper count and nothing else.
 *
 * It also reports `reads` and `answered`, which is how the caller tells "these
 * posts drew no zaps" from "no relay would answer" — a distinction
 * `fetchEngagement` cannot make, because it reports a dead relay as a zero.
 */
async function countZappers(
  ids: readonly string[],
  relays: string[],
  budgetMs: number,
  opts: DiscussionOptions,
  lnurlTimeoutMs: number,
): Promise<ZapperPass> {
  const deadline = Deadline.in(budgetMs);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    chunks.push([...ids.slice(i, i + CHUNK_SIZE)]);
  }

  const receipts: Event[] = [];
  const seen = new Set<string>();
  const answered = new Set<string>();
  let performed = 0;
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    if (deadline.expired()) break;
    const batch = chunks.slice(i, i + CONCURRENCY);
    const reads = await Promise.all(
      batch.map((chunk) => {
        const filter: Filter = {
          kinds: [NOSTR_KINDS.ZAP_RECEIPT],
          "#e": chunk,
          limit: EVENTS_PER_QUERY,
        };
        return readRelays(filter, relays, deadline);
      }),
    );
    performed += reads.length;
    for (const read of reads) {
      for (const url of read.answered) answered.add(url);
      for (const event of read.events) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        receipts.push(event);
      }
    }
  }

  const base = { reads: performed, answered: answered.size };
  if (receipts.length === 0) return { ...base, zappers: 0, accepted: 0 };

  const identities = await countZapperIdentities(receipts, {
    relays,
    // The provider lookups get their own budget: `deadline` is very likely spent
    // by now, and an expired one would make `readRelays` skip the kind:0 read
    // and reject every receipt for want of a profile.
    deadline: Deadline.in(budgetMs),
    trust: opts.zapTrust,
    lnurlTimeoutMs,
  });
  return {
    ...base,
    zappers: identities.zappers,
    accepted: identities.accepted,
  };
}

/** What the distinct-zapper pass learned, including whether it was heard. */
interface ZapperPass {
  zappers: number;
  accepted: number;
  /** `readRelays` calls actually made. Zero means the budget was gone. */
  reads: number;
  /** Distinct relays that reached EOSE on at least one of those reads. */
  answered: number;
}

function phaseBudget(budgetMs: number, share: number): number {
  const raw = Math.round(Math.max(0, budgetMs) * share);
  return Math.min(MAX_PHASE_MS, Math.max(MIN_PHASE_MS, raw));
}

function excerpt(content: string): string {
  const flat = typeof content === "string" ? content.replace(/\s+/g, " ").trim() : "";
  if (flat.length <= MAX_EXCERPT_CHARS) return flat;
  return `${flat.slice(0, MAX_EXCERPT_CHARS - 1)}…`;
}
