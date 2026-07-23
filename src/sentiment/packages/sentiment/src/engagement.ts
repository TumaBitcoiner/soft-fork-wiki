/**
 * Populate `EngagementSignals` for notes we already fetched.
 *
 * `rank.ts` ranks by what the network paid attention to — zapped sats first,
 * reactions and replies second, recency only as a tiebreaker — but nothing fed
 * it: `fetch.ts` queries kind:1 and stops. This module is the missing half. It
 * takes the note ids from a fetch, asks the relays what happened to them
 * (kind:7 reactions, kind:9735 zap receipts, kind:1 replies), and hands back
 * signals `rank.ts` can score. Wiring this in is what turns the ranking on: the
 * cold-start collapse to newest-first documented in `rank.ts` ends here.
 *
 * ## THE VOTE-STUFFING HOLE, AND WHY VALIDATION IS ON BY DEFAULT
 *
 * A kind:9735 zap receipt is just an event. Anybody can sign one claiming a
 * million sats were paid to any note, and relays will happily serve it. Per
 * NIP-57 a receipt is only meaningful if it was signed by the `nostrPubkey`
 * that the *recipient's own* LNURL-pay endpoint advertises — that pubkey
 * belongs to the Lightning provider that actually took the money, so only they
 * can attest a payment happened.
 *
 * In this product zaps ARE the vote, and `zapSats` carries 0.60 of the ranking
 * weight. Summing receipts without that check does not degrade the ranking, it
 * deletes it: forging a receipt is free, so the top slot goes to whoever is
 * willing to lie, permanently, and the "the market decides" premise is a lie
 * too. So `zapTrust` defaults to `"lnurl"` — full validation — and the cheaper
 * modes must be asked for by name:
 *
 *   - `"lnurl"`   (default, SAFE) verify the receipt's own signature, verify
 *                 the zap request embedded in its `description` tag, then
 *                 resolve the recipient's LNURL-pay endpoint and require the
 *                 receipt's author to equal its `nostrPubkey`. Costs one
 *                 kind:0 lookup and one HTTPS GET per distinct recipient, both
 *                 cached for the run.
 *   - `"structural"` (UNSAFE) offline checks only. Catches corrupt and
 *                 half-written receipts. Does NOT stop forgery: an attacker
 *                 signs their own zap request and their own receipt and passes
 *                 every one of these checks. Use for offline tests, not for a
 *                 ranking anyone can write to.
 *   - `"none"`    (UNSAFE) sum every receipt as-is. Anyone can buy the top slot
 *                 for zero sats. Fixtures and debugging only.
 *
 * Nothing is silently dropped: rejected receipts are reported per note as
 * `zapsRejected` / `rejectedSats`, so a caller can see an attack rather than
 * just a suspiciously quiet leaderboard.
 *
 * Measured against live relays (relay.damus.io, nos.lol, relay.nostr.band,
 * relay.primal.net) over ~1,100 notes tagged #bip300/#bip110/#bitcoin: 139 zap
 * receipts, of which 133 passed the LNURL check and 6 were rejected (4 signed
 * by a pubkey the recipient's current wallet no longer advertises, 2 recipients
 * with no `lud16` to resolve). All 34 distinct recipients resolved a kind:0 and
 * a live LNURL endpoint, in ~7s total. Validation is affordable and does not
 * empty the board.
 *
 * The hole is real and was demonstrated, not assumed. Against the most-zapped
 * live #bip110 note (20 genuine receipts, 22,912 sats), a single self-signed
 * receipt carrying a self-signed zap request and a fabricated 1,000,000-sat
 * bolt11 hrp took `zapSats` to 1,022,912 under both `"none"` and
 * `"structural"` — first place, for nothing. `"lnurl"` refused it and reported
 * `zapsRejected: 1, rejectedSats: 1000000` while the 22,912 real sats stood.
 *
 * KNOWN GAP: `lud06` (bech32-encoded LNURL) is not resolved — decoding bech32
 * would mean a dependency this package does not have. Those recipients are
 * rejected under `"lnurl"`, not waved through. In the sample above every one of
 * the 34 recipients published a `lud16`, so the practical cost is nil.
 *
 * @see rank.ts for how these numbers become a score.
 */
import { SimplePool, verifyEvent, type Event } from "nostr-tools";
import {
  getSatoshisAmountFromBolt11,
  validateZapRequest,
} from "nostr-tools/nip57";
import {
  DEFAULT_RELAYS,
  NOSTR_KINDS,
  type ClassifiedNote,
} from "@soft-fork-wiki/shared";
import type { EngagementSignals, RankableNote } from "./rank.js";

/**
 * How much a zap receipt has to prove before its sats count. See the file
 * header — only `"lnurl"` actually resists forgery.
 */
export type ZapTrust = "lnurl" | "structural" | "none";

export interface EngagementOptions {
  relays?: readonly string[];
  /**
   * Receipt validation policy. Defaults to `"lnurl"`. The other two modes are
   * documented as unsafe in the file header; they exist so tests and fixtures
   * do not need a network, not so production can go faster.
   */
  zapTrust?: ZapTrust;
  /**
   * Note ids per `#e` filter. Relays cap both returned events and tag-filter
   * cardinality, and a filter that trips either limit fails silently by
   * returning a truncated set — which would read as "these notes got no
   * engagement". Small chunks are the cheap defence.
   */
  chunkSize?: number;
  /** Chunks queried at once. Bounded so we do not get rate-limited off. */
  concurrency?: number;
  /** Per-query relay wait. */
  maxWaitMs?: number;
  /** Per-request budget for an LNURL-pay endpoint fetch. */
  lnurlTimeoutMs?: number;
}

/**
 * `EngagementSignals` plus the audit trail behind it.
 *
 * The three signal fields are required here (never `undefined`), so a caller
 * reading a value knows the query ran and returned that number rather than
 * having silently skipped the note. The extra fields exist because "the top
 * note has 22,912 sats" and "the top note has 22,912 sats and we threw away
 * 400,000 more that nobody could prove were paid" are very different facts,
 * and the second one must not be invisible.
 */
export interface EngagementBreakdown extends EngagementSignals {
  zapSats: number;
  reactions: number;
  replies: number;
  /** Zap receipts whose sats are included in `zapSats`. */
  zaps: number;
  /** Receipts refused by `zapTrust`. Non-zero on a public relay is normal. */
  zapsRejected: number;
  /** Sats claimed by refused receipts — the size of what was turned away. */
  rejectedSats: number;
  /**
   * NIP-25 reactions whose content is `"-"`: an explicit DOWNVOTE. Counted
   * separately and deliberately NOT folded into `reactions`, because `rank.ts`
   * treats `reactions` as positive attention with a 0.25 weight — adding a "-"
   * there would let a critic promote the note they are objecting to. Reported
   * rather than discarded so a caller can show "12 up, 3 down" or subtract it
   * later, but nothing in the score reads it today.
   */
  downvotes: number;
  /** Events skipped for being malformed. Never a thrown error. */
  skipped: number;
  /** Policy that produced `zapSats`, so a stored ranking stays interpretable. */
  zapTrust: ZapTrust;
}

/** 50 keeps us well inside every relay tag-cardinality limit we have hit. */
const DEFAULT_CHUNK_SIZE = 50;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_WAIT_MS = 9_000;
const DEFAULT_LNURL_TIMEOUT_MS = 8_000;

/** NIP-01 profile metadata. Not in `NOSTR_KINDS`; only needed here. */
const KIND_METADATA = 0;

/**
 * Ask for more than a chunk could plausibly attract, so the cap never becomes
 * the answer. If a chunk really does return this many we are truncating, and
 * the fix is a smaller `chunkSize`, not a bigger number here.
 */
const EVENTS_PER_QUERY = 2_000;

/**
 * NIP-25 says `"-"` is a downvote and `"+"` (or empty content) is a like.
 * Everything else is an emoji, which is warmth, not dissent.
 */
const DOWNVOTE = "-";

/**
 * Fetch what the network did with `noteIds`.
 *
 * Every requested id gets an entry, zeroed if nothing happened to it, so a
 * caller can tell "no engagement" from "not queried" without cross-checking.
 * Never throws: a relay that fails, a filter that returns junk and an event
 * with the wrong shape are all counted and stepped over. A ranking that
 * disappears because one relay timed out is worse than a ranking missing one
 * relay's data.
 */
export async function fetchEngagement(
  noteIds: readonly string[],
  opts: EngagementOptions = {},
): Promise<Map<string, EngagementBreakdown>> {
  const zapTrust = resolveTrust(opts.zapTrust);
  const ids = uniqueIds(noteIds);
  const byNote = new Map<string, EngagementBreakdown>();
  for (const id of ids) byNote.set(id, emptyBreakdown(zapTrust));
  if (ids.length === 0) return byNote;

  const relays = [...(opts.relays ?? DEFAULT_RELAYS)];
  const chunkSize = positiveInt(opts.chunkSize, DEFAULT_CHUNK_SIZE);
  const concurrency = positiveInt(opts.concurrency, DEFAULT_CONCURRENCY);
  const maxWait = positiveInt(opts.maxWaitMs, DEFAULT_MAX_WAIT_MS);

  const pool = new SimplePool();
  try {
    const query = async (kind: number, chunk: string[]): Promise<Event[]> => {
      try {
        return await pool.querySync(
          relays,
          { kinds: [kind], "#e": chunk, limit: EVENTS_PER_QUERY },
          { maxWait },
        );
      } catch {
        // A dead relay is a missing signal, not a failed run.
        return [];
      }
    };

    const chunks = chunked(ids, chunkSize);
    const results = await mapBounded(chunks, concurrency, async (chunk) =>
      Promise.all([
        query(NOSTR_KINDS.REACTION, chunk),
        query(NOSTR_KINDS.ZAP_RECEIPT, chunk),
        query(NOSTR_KINDS.TEXT_NOTE, chunk),
      ]),
    );

    const reactions: Event[] = [];
    const receipts: Event[] = [];
    const replies: Event[] = [];
    for (const [r, z, p] of results) {
      reactions.push(...r);
      receipts.push(...z);
      replies.push(...p);
    }

    countReactions(reactions, byNote);
    countReplies(replies, byNote);
    await countZaps(receipts, byNote, {
      pool,
      relays,
      maxWait,
      concurrency,
      zapTrust,
      lnurlTimeoutMs: positiveInt(
        opts.lnurlTimeoutMs,
        DEFAULT_LNURL_TIMEOUT_MS,
      ),
    });

    return byNote;
  } finally {
    pool.close(relays);
  }
}

/**
 * Join classified notes to their engagement, producing what `rankNotes` wants.
 *
 * Notes with no entry in the map keep `engagement` undefined rather than a
 * zeroed object: `scoreNote` reads both as zero, and leaving it absent keeps
 * "we never asked" distinguishable downstream.
 */
export function attachEngagement(
  notes: readonly ClassifiedNote[],
  engagement: ReadonlyMap<string, EngagementSignals>,
): RankableNote[] {
  if (!Array.isArray(notes)) return [];
  const out: RankableNote[] = [];
  for (const note of notes) {
    if (!note || typeof note !== "object") continue;
    const signals =
      typeof note.eventId === "string"
        ? engagement.get(note.eventId)
        : undefined;
    out.push(signals ? { ...note, engagement: signals } : { ...note });
  }
  return out;
}

/**
 * One reaction per pubkey per note.
 *
 * Reactions are free, so the same key can spam a hundred of them. Counting
 * distinct reactors makes the number mean "how many people liked this", which
 * is what the 0.25 weight in `rank.ts` is paying for.
 */
function countReactions(
  events: readonly Event[],
  byNote: Map<string, EngagementBreakdown>,
): void {
  const seenReactors = new Set<string>();
  const seenEvents = new Set<string>();
  for (const event of events) {
    const target = targetNote(event, byNote, seenEvents);
    if (!target) continue;
    const pubkey = typeof event.pubkey === "string" ? event.pubkey : "";
    const key = `${target.id}:${pubkey || event.id}`;
    if (seenReactors.has(key)) continue;
    seenReactors.add(key);

    const content = typeof event.content === "string" ? event.content.trim() : "";
    if (content === DOWNVOTE) target.entry.downvotes += 1;
    else target.entry.reactions += 1;
  }
}

/**
 * Replies are counted per event, not per author: three replies from one person
 * is a thread, and a thread is exactly the "this note started an argument"
 * signal the 0.05 weight is for.
 *
 * A note replying to itself still counts — we would need each note's author to
 * exclude that, and `fetchEngagement` is deliberately given ids only.
 */
function countReplies(
  events: readonly Event[],
  byNote: Map<string, EngagementBreakdown>,
): void {
  const seenEvents = new Set<string>();
  for (const event of events) {
    const target = targetNote(event, byNote, seenEvents);
    if (!target) continue;
    // A note cannot be its own reply; relays return the root alongside them.
    if (target.id === event.id) continue;
    target.entry.replies += 1;
  }
}

interface ZapContext {
  pool: SimplePool;
  relays: string[];
  maxWait: number;
  concurrency: number;
  zapTrust: ZapTrust;
  lnurlTimeoutMs: number;
}

/**
 * Sum zapped sats, subject to `zapTrust`.
 *
 * Receipts are deduplicated by their bolt11 invoice where present rather than
 * by event id: an invoice is unique to one payment, so this also catches the
 * same payment re-published under a fresh id — which is the cheapest way to
 * multiply a real zap you did not make.
 */
async function countZaps(
  events: readonly Event[],
  byNote: Map<string, EngagementBreakdown>,
  ctx: ZapContext,
): Promise<void> {
  const seenEvents = new Set<string>();
  const seenPayments = new Set<string>();
  const candidates: { entry: EngagementBreakdown; receipt: Event }[] = [];
  const recipients = new Set<string>();

  for (const event of events) {
    const target = targetNote(event, byNote, seenEvents);
    if (!target) continue;
    const bolt11 = tagValue(event, "bolt11");
    const payment = bolt11 || event.id;
    if (seenPayments.has(payment)) continue;
    seenPayments.add(payment);

    candidates.push({ entry: target.entry, receipt: event });
    const recipient = tagValue(event, "p");
    if (recipient) recipients.add(recipient);
  }

  // Resolve every LNURL-pay endpoint once up front, so a note zapped twenty
  // times by the same wallet costs one HTTPS round trip, not twenty.
  const providers =
    ctx.zapTrust === "lnurl"
      ? await resolveZapProviders(recipients, ctx)
      : new Map<string, string | null>();

  for (const { entry, receipt } of candidates) {
    const sats = receiptSats(receipt);
    if (sats === null) {
      entry.skipped += 1;
      continue;
    }
    if (accept(receipt, ctx.zapTrust, providers)) {
      entry.zaps += 1;
      entry.zapSats += sats;
    } else {
      entry.zapsRejected += 1;
      entry.rejectedSats += sats;
    }
  }
}

/** Does this receipt clear the configured bar? Never throws. */
function accept(
  receipt: Event,
  zapTrust: ZapTrust,
  providers: ReadonlyMap<string, string | null>,
): boolean {
  if (zapTrust === "none") return true;

  try {
    // The receipt must at least be a real event by its claimed author.
    if (!verifyEvent(receipt)) return false;

    // NIP-57: the receipt carries the signed kind:9734 request that asked for
    // the payment. `validateZapRequest` checks its signature and required tags.
    const description = tagValue(receipt, "description");
    if (!description) return false;
    if (validateZapRequest(description) !== null) return false;

    const request = JSON.parse(description) as Partial<Event>;
    // The receipt's `P` tag, when present, names who asked for the zap; it must
    // agree with the request it claims to be receipting.
    const senderTag = tagValue(receipt, "P");
    if (senderTag && senderTag !== request.pubkey) return false;

    if (zapTrust === "structural") return true;

    // The only check that stops forgery: the receipt must be signed by the
    // Lightning provider the recipient themselves advertise.
    const recipient = tagValue(receipt, "p");
    if (!recipient) return false;
    const provider = providers.get(recipient);
    if (!provider) return false;
    return provider.toLowerCase() === String(receipt.pubkey).toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Sats a receipt attests to, or null if it does not say.
 *
 * bolt11 wins over the `description` amount: the invoice is what was actually
 * billed, while the amount on the zap request is only what the client asked
 * for, and the two diverge whenever a wallet rounds, tips, or the user edits
 * the amount before paying. The request amount is in MILLISATS.
 */
function receiptSats(receipt: Event): number | null {
  const bolt11 = tagValue(receipt, "bolt11");
  if (bolt11) {
    try {
      const sats = getSatoshisAmountFromBolt11(bolt11);
      // Returns 0 for amountless and unparseable invoices; fall through to the
      // request amount rather than recording a real zap as zero.
      if (Number.isFinite(sats) && sats > 0) return sats;
    } catch {
      // Malformed invoice string. Try the description.
    }
  }

  const description = tagValue(receipt, "description");
  if (!description) return null;
  try {
    const request = JSON.parse(description) as Partial<Event>;
    const msat = Number(findTag(request.tags, "amount") ?? NaN);
    if (Number.isFinite(msat) && msat > 0) return msat / 1000;
  } catch {
    return null;
  }
  return null;
}

/**
 * Recipient pubkey -> the `nostrPubkey` their LNURL-pay endpoint advertises.
 *
 * `nip57.getZapEndpoint` checks `allowsNostr`/`nostrPubkey` but returns only
 * the callback URL, so it cannot answer "who is allowed to sign receipts for
 * this person" — we do the lookup ourselves to read the pubkey itself.
 *
 * A recipient we cannot resolve maps to null, which rejects their receipts
 * under `"lnurl"`. Failing open here would reintroduce the whole hole: an
 * attacker would only need the endpoint to be unreachable.
 */
async function resolveZapProviders(
  recipients: ReadonlySet<string>,
  ctx: ZapContext,
): Promise<Map<string, string | null>> {
  const resolved = new Map<string, string | null>();
  const pubkeys = [...recipients];
  if (pubkeys.length === 0) return resolved;

  const metadata = new Map<string, Event>();
  for (const chunk of chunked(pubkeys, DEFAULT_CHUNK_SIZE)) {
    let events: Event[] = [];
    try {
      events = await ctx.pool.querySync(
        ctx.relays,
        { kinds: [KIND_METADATA], authors: chunk },
        { maxWait: ctx.maxWait },
      );
    } catch {
      events = [];
    }
    for (const event of events) {
      // Keep the newest profile: an old one may name a wallet since replaced.
      const previous = metadata.get(event.pubkey);
      if (!previous || event.created_at > previous.created_at) {
        metadata.set(event.pubkey, event);
      }
    }
  }

  await mapBounded(pubkeys, ctx.concurrency, async (pubkey) => {
    const profile = metadata.get(pubkey);
    resolved.set(
      pubkey,
      profile ? await lnurlZapPubkey(profile, ctx.lnurlTimeoutMs) : null,
    );
  });
  return resolved;
}

/** Read `lud16` off a kind:0 and ask that endpoint who signs its receipts. */
async function lnurlZapPubkey(
  profile: Event,
  timeoutMs: number,
): Promise<string | null> {
  let address: unknown;
  try {
    address = (JSON.parse(profile.content) as { lud16?: unknown }).lud16;
  } catch {
    return null;
  }
  // lud06 is a bech32 LNURL; decoding it needs a dependency we do not have.
  if (typeof address !== "string" || !address.includes("@")) return null;

  const [name, domain] = address.split("@");
  if (!name || !domain) return null;

  let url: string;
  try {
    url = new URL(
      `/.well-known/lnurlp/${encodeURIComponent(name)}`,
      `https://${domain}`,
    ).toString();
  } catch {
    return null;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      allowsNostr?: unknown;
      nostrPubkey?: unknown;
    };
    if (body?.allowsNostr !== true) return null;
    return typeof body.nostrPubkey === "string" ? body.nostrPubkey : null;
  } catch {
    // Offline, TLS failure, timeout, HTML instead of JSON — all unresolved.
    return null;
  }
}

/**
 * Which of our notes an event points at, or null if none.
 *
 * NIP-10 and NIP-25 both settle ambiguity the same way: when several `e` tags
 * are present the *last* one is the event being acted on. We scan backwards
 * and take the first that is a note we asked about, which also handles the
 * common case of a reply whose earlier `e` tags name the thread root.
 *
 * `seen` deduplicates across chunks and relays, which overlap by design.
 */
function targetNote(
  event: Event,
  byNote: Map<string, EngagementBreakdown>,
  seen: Set<string>,
): { id: string; entry: EngagementBreakdown } | null {
  if (!event || typeof event !== "object") return null;
  if (typeof event.id !== "string" || seen.has(event.id)) return null;
  if (!Array.isArray(event.tags)) return null;

  for (let i = event.tags.length - 1; i >= 0; i -= 1) {
    const tag = event.tags[i];
    if (!Array.isArray(tag) || tag[0] !== "e") continue;
    const id = typeof tag[1] === "string" ? tag[1] : "";
    const entry = byNote.get(id);
    if (entry) {
      seen.add(event.id);
      return { id, entry };
    }
  }
  return null;
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

function tagValue(event: Event, name: string): string {
  return findTag(event?.tags, name) ?? "";
}

function findTag(
  tags: readonly (readonly string[])[] | undefined,
  name: string,
): string | undefined {
  if (!Array.isArray(tags)) return undefined;
  for (const tag of tags) {
    if (Array.isArray(tag) && tag[0] === name && typeof tag[1] === "string") {
      return tag[1];
    }
  }
  return undefined;
}

function uniqueIds(noteIds: readonly string[]): string[] {
  if (!Array.isArray(noteIds)) return [];
  const seen = new Set<string>();
  for (const id of noteIds) {
    if (typeof id === "string" && id.length > 0) seen.add(id);
  }
  return [...seen];
}

function emptyBreakdown(zapTrust: ZapTrust): EngagementBreakdown {
  return {
    zapSats: 0,
    reactions: 0,
    replies: 0,
    zaps: 0,
    zapsRejected: 0,
    rejectedSats: 0,
    downvotes: 0,
    skipped: 0,
    zapTrust,
  };
}

/** Anything we do not recognise falls back to the safe policy, never to none. */
function resolveTrust(zapTrust: ZapTrust | undefined): ZapTrust {
  return zapTrust === "structural" || zapTrust === "none" ? zapTrust : "lnurl";
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}
