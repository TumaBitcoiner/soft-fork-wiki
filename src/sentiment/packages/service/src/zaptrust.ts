/**
 * Turn kind:9735 zap receipts into votes we are willing to count.
 *
 * ## WHY THIS IS NOT JUST `parseZapReceipt`
 *
 * `voting/zap.ts#parseZapReceipt` answers "what does this receipt claim?". It
 * reads the embedded kind:9734 request and hands back a stance and an amount.
 * It deliberately does not ask "is any of that true", because a receipt is just
 * an event: anyone can sign one claiming a million sats moved to any pubkey,
 * and relays will serve it.
 *
 * In the zaps-and-votes gauge the sats ARE the score — `score` is
 * `(satsFor - satsAgainst) / (satsFor + satsAgainst)`. Summing unverified
 * receipts does not make the gauge noisy, it deletes it: forging a receipt is
 * free, so the needle belongs to whoever is willing to lie. So this module
 * applies the same NIP-57 bar `sentiment/engagement.ts` documents and defaults
 * to the same policy, `"lnurl"`:
 *
 *   - `"lnurl"` (default, SAFE) the receipt verifies as an event, the zap
 *     request inside its `description` verifies too, the `P` tag agrees with
 *     that request, and the receipt's author equals the `nostrPubkey` that the
 *     RECIPIENT'S OWN LNURL-pay endpoint advertises. Only the Lightning
 *     provider that took the money can attest the payment.
 *   - `"structural"` (UNSAFE) offline checks only. Catches corruption, not
 *     forgery — an attacker signs their own request and their own receipt and
 *     passes every one of these.
 *   - `"none"` (UNSAFE) count everything. Fixtures only.
 *
 * We do not reimplement the LNURL walk: `voting/lnurl.ts#resolveLightningAddress`
 * already does it with the SSRF guards (HTTPS only, no private hosts, capped
 * bodies, redirects re-validated), and reusing it means an address payable
 * through the voting package is one whose receipts count here.
 *
 * ## TWO CALLERS, ONE BAR
 *
 * `verifyZapOpinions` counts OUR zaps — receipts anchored to app-tagged events,
 * which carry a stance and are therefore votes. `countZapperIdentities` counts
 * WHO paid on ordinary public posts about a BIP, which carry no stance at all
 * (see `discussion.ts`). They answer different questions and are reported in
 * different halves of the payload, but they clear the identical `accept()` bar
 * and share the identical provider cache, so "verified" means one thing here.
 *
 * ## THE LATENCY DEAL
 *
 * Validation costs one kind:0 read plus one HTTPS GET per DISTINCT recipient.
 * A BIP has two zap anchors (FOR and AGAINST), so that is two lookups no matter
 * how many people zap — and they are memoised process-wide for
 * `PROVIDER_TTL_MS`, so during a demo it is two lookups total, once. With zero
 * zaps it costs nothing at all, because there is no recipient to resolve.
 *
 * The public-discussion path is where the cache earns its keep: those receipts
 * are signed by a handful of Lightning custodians shared across every BIP, so
 * after the first request almost every recipient is already resolved. The HTTPS
 * hop underneath is memoised a second time, process-wide, by `lnurlcache.ts` —
 * which is what makes `sentiment/engagement.ts` (whose own provider map is
 * per-call, and which is not ours to change) cheap on a warm process too.
 *
 * Nothing here throws. An unresolvable recipient maps to null, which REJECTS
 * their receipts rather than waving them through — failing open would reopen
 * the whole hole, since an attacker would only need the endpoint unreachable.
 */
import { verifyEvent, type Event } from "nostr-tools";
import {
  getSatoshisAmountFromBolt11,
  validateZapRequest,
} from "nostr-tools/nip57";
import type { Opinion } from "@soft-fork-wiki/shared";
import { parseZapReceipt, resolveLightningAddress } from "@soft-fork-wiki/voting";
import type { ZapTrust } from "@soft-fork-wiki/sentiment";
import { readRelays, type Deadline } from "./relays.js";

/** NIP-01 profile metadata; the only place a `lud16` lives. */
const KIND_METADATA = 0;

/**
 * How long a resolved LNURL `nostrPubkey` is reused.
 *
 * One hour rather than the ten minutes this started at. The value is a
 * custodian's signing key, which changes only when a user moves wallets — and
 * when they do, their OLD receipts stop verifying anyway, so a stale entry
 * costs a recently-migrated user's newest zaps a rejection for at most an hour,
 * against paying an HTTPS round trip per recipient per request. Measured, that
 * round trip was the dominant cost of the whole route.
 */
const PROVIDER_TTL_MS = 60 * 60 * 1000;

/** Per-hop HTTP budget for an LNURL-pay endpoint. */
const DEFAULT_LNURL_TIMEOUT_MS = 2_500;

interface ProviderEntry {
  /** Hex pubkey allowed to sign this recipient's receipts, or null if unknown. */
  nostrPubkey: string | null;
  expiresAt: number;
}

const providerCache = new Map<string, ProviderEntry>();
let providerHits = 0;
let providerMisses = 0;

/** Drop memoised LNURL lookups. For tests and for `?refresh=1` semantics. */
export function clearZapProviderCache(): void {
  providerCache.clear();
  providerHits = 0;
  providerMisses = 0;
}

export interface ZapProviderCacheStats {
  /** Recipients currently resolved (including cached negatives). */
  entries: number;
  /** Recipients answered from memory. */
  hits: number;
  /** Recipients that needed a kind:0 read and an HTTPS GET. */
  misses: number;
  /** Entry lifetime, so a stale-looking rejection is explainable. */
  ttlMs: number;
}

/** Counters for `/health`, so cache behaviour is observable during a demo. */
export function zapProviderCacheStats(): ZapProviderCacheStats {
  return {
    entries: providerCache.size,
    hits: providerHits,
    misses: providerMisses,
    ttlMs: PROVIDER_TTL_MS,
  };
}

/** What a batch of receipts turned into, plus the audit trail behind it. */
export interface ZapVerification {
  /** Receipts that cleared the bar, as `Opinion`s ready for `tallyOpinions`. */
  opinions: Opinion[];
  /** How many receipts were counted. */
  accepted: number;
  /** How many were refused by the policy. Non-zero on a public relay is normal. */
  rejected: number;
  /** Sats those refused receipts claimed — the size of what was turned away. */
  rejectedSats: number;
  /** Receipts that were ours but did not state an amount we could read. */
  skipped: number;
  /** The policy that produced these numbers, so a stored result stays readable. */
  trust: ZapTrust;
}

export interface VerifyZapsOptions {
  relays: readonly string[];
  deadline: Deadline;
  trust?: ZapTrust;
  lnurlTimeoutMs?: number;
}

/** Anything unrecognised falls back to the safe policy, never to `none`. */
export function resolveZapTrust(value: string | undefined): ZapTrust {
  return value === "structural" || value === "none" ? value : "lnurl";
}

/**
 * Verify zap receipts for one BIP and return the votes they represent.
 *
 * Receipts that are not ours (no `softforkwiki` tag on the embedded request, or
 * a different BIP) are dropped silently and counted nowhere: they are somebody
 * else's zap, not a rejected ballot.
 *
 * Deduplication is by bolt11 invoice where present rather than by event id: an
 * invoice is unique to one payment, so this also catches the same real payment
 * republished under a fresh id, which is the cheapest way to multiply a zap you
 * never made.
 */
export async function verifyZapOpinions(
  receipts: readonly Event[],
  bipNumber: number,
  opts: VerifyZapsOptions,
): Promise<ZapVerification> {
  const trust = resolveZapTrust(opts.trust);
  const out: ZapVerification = {
    opinions: [],
    accepted: 0,
    rejected: 0,
    rejectedSats: 0,
    skipped: 0,
    trust,
  };

  const seenPayments = new Set<string>();
  const candidates: { receipt: Event; opinion: Opinion }[] = [];
  const recipients = new Set<string>();

  for (const receipt of receipts) {
    if (!receipt || typeof receipt !== "object") continue;
    const payment = tagValue(receipt, "bolt11") || String(receipt.id ?? "");
    if (!payment || seenPayments.has(payment)) continue;
    seenPayments.add(payment);

    const opinion = safeParse(receipt);
    if (!opinion || opinion.bipNumber !== bipNumber) continue;

    candidates.push({ receipt, opinion });
    const recipient = tagValue(receipt, "p");
    if (recipient) recipients.add(recipient);
  }

  if (candidates.length === 0) return out;

  const providers =
    trust === "lnurl"
      ? await resolveProviders(recipients, opts)
      : new Map<string, string | null>();

  for (const { receipt, opinion } of candidates) {
    const sats = receiptSats(receipt);
    if (sats === null) {
      out.skipped += 1;
      continue;
    }
    if (!accept(receipt, trust, providers)) {
      out.rejected += 1;
      out.rejectedSats += sats;
      continue;
    }
    out.accepted += 1;
    // The bolt11 is what a wallet actually paid; the request's `amount` tag is
    // only what the client asked for, and the two diverge whenever a wallet
    // rounds, tips, or the user edits the amount. The money-weighted score has
    // to follow the money, so the invoice wins.
    out.opinions.push({ ...opinion, amountMsat: Math.round(sats * 1000) });
  }

  return out;
}

/** Who paid, on receipts that cleared the same bar the sats totals clear. */
export interface ZapperIdentities {
  /** Distinct pubkeys that paid at least one accepted zap. */
  zappers: number;
  /** Accepted receipts those pubkeys account for — `zappers`' denominator. */
  accepted: number;
  /** Receipts refused by the policy. */
  rejected: number;
  /** Receipts stating no amount we could read; not counted either way. */
  skipped: number;
  /** The policy applied, so the number stays interpretable. */
  trust: ZapTrust;
}

/**
 * Count the DISTINCT PEOPLE behind a pile of public zap receipts.
 *
 * `sentiment/engagement.ts` is the authority on how many sats moved and how
 * many receipts were valid, but it aggregates per note and never surfaces a
 * payer, so "77 zaps" cannot be turned into "how many people is that?" from its
 * output alone. This does exactly and only that: same `accept()` bar, same
 * memoised providers, no second opinion on the money.
 *
 * The payer is the `pubkey` of the kind:9734 request embedded in the receipt's
 * `description` — that is the key that signed "I want to zap this". The `P` tag
 * is the fallback for receipts that carry it. Anonymous zaps sign with a
 * throwaway key and therefore each count as their own person, which overstates
 * distinctness slightly; there is no way to do better, and undercounting by
 * lumping every anonymous zap into one "person" would be worse.
 *
 * Never throws. Deduplicated by bolt11 invoice, like every other receipt path
 * here.
 */
export async function countZapperIdentities(
  receipts: readonly Event[],
  opts: VerifyZapsOptions,
): Promise<ZapperIdentities> {
  const trust = resolveZapTrust(opts.trust);
  const out: ZapperIdentities = {
    zappers: 0,
    accepted: 0,
    rejected: 0,
    skipped: 0,
    trust,
  };

  const seenPayments = new Set<string>();
  const candidates: Event[] = [];
  const recipients = new Set<string>();

  for (const receipt of receipts) {
    if (!receipt || typeof receipt !== "object") continue;
    const payment = tagValue(receipt, "bolt11") || String(receipt.id ?? "");
    if (!payment || seenPayments.has(payment)) continue;
    seenPayments.add(payment);
    candidates.push(receipt);
    const recipient = tagValue(receipt, "p");
    if (recipient) recipients.add(recipient);
  }
  if (candidates.length === 0) return out;

  const providers =
    trust === "lnurl"
      ? await resolveProviders(recipients, opts)
      : new Map<string, string | null>();

  const payers = new Set<string>();
  for (const receipt of candidates) {
    if (receiptSats(receipt) === null) {
      out.skipped += 1;
      continue;
    }
    if (!accept(receipt, trust, providers)) {
      out.rejected += 1;
      continue;
    }
    out.accepted += 1;
    const payer = payerPubkey(receipt);
    if (payer) payers.add(payer);
  }

  out.zappers = payers.size;
  return out;
}

/** The key that signed the zap request, or the `P` tag. Never throws. */
function payerPubkey(receipt: Event): string {
  const senderTag = tagValue(receipt, "P");
  const description = tagValue(receipt, "description");
  if (description) {
    try {
      const request = JSON.parse(description) as Partial<Event>;
      if (typeof request.pubkey === "string" && request.pubkey) {
        return request.pubkey.toLowerCase();
      }
    } catch {
      // Fall through to the tag.
    }
  }
  return senderTag ? senderTag.toLowerCase() : "";
}

/** `parseZapReceipt` on hostile input, without letting a throw reach the route. */
function safeParse(receipt: Event): Opinion | null {
  try {
    return parseZapReceipt(receipt);
  } catch {
    return null;
  }
}

/** Does this receipt clear the configured bar? Never throws. */
function accept(
  receipt: Event,
  trust: ZapTrust,
  providers: ReadonlyMap<string, string | null>,
): boolean {
  if (trust === "none") return true;

  try {
    // It must at least be a real event signed by its claimed author.
    if (!verifyEvent(receipt)) return false;

    // NIP-57: the receipt carries the signed kind:9734 that asked for the
    // payment. `validateZapRequest` returns a string ON FAILURE and null when
    // the request is well formed and correctly signed.
    const description = tagValue(receipt, "description");
    if (!description) return false;
    if (validateZapRequest(description) !== null) return false;

    const request = JSON.parse(description) as Partial<Event>;
    // `P`, when present, names who asked for the zap; it must agree with the
    // request the receipt claims to be receipting.
    const senderTag = tagValue(receipt, "P");
    if (senderTag && senderTag !== request.pubkey) return false;

    if (trust === "structural") return true;

    // The only check that stops forgery.
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
 * bolt11 first for the reason given above; the request `amount` tag (in
 * MILLISATS) is the fallback for amountless invoices.
 */
function receiptSats(receipt: Event): number | null {
  const bolt11 = tagValue(receipt, "bolt11");
  if (bolt11) {
    try {
      const sats = getSatoshisAmountFromBolt11(bolt11);
      // Returns 0 for amountless AND for unparseable invoices, so fall through
      // rather than recording a real zap as a zero-sat one.
      if (Number.isFinite(sats) && sats > 0) return sats;
    } catch {
      // Malformed invoice. Try the description.
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
 * One kind:0 read for all unresolved recipients at once, then one HTTPS GET
 * each, both memoised for `PROVIDER_TTL_MS`. Negative results are cached too: a
 * recipient with no `lud16` should not cost an HTTPS round trip on every poll of
 * the gauge.
 */
async function resolveProviders(
  recipients: ReadonlySet<string>,
  opts: VerifyZapsOptions,
): Promise<Map<string, string | null>> {
  const resolved = new Map<string, string | null>();
  const now = Date.now();
  const missing: string[] = [];

  for (const pubkey of recipients) {
    const hit = providerCache.get(pubkey);
    if (hit && hit.expiresAt > now) {
      providerHits += 1;
      resolved.set(pubkey, hit.nostrPubkey);
    } else {
      providerMisses += 1;
      missing.push(pubkey);
    }
  }
  if (missing.length === 0) return resolved;

  const { events } = await readRelays(
    { kinds: [KIND_METADATA], authors: missing },
    opts.relays,
    opts.deadline,
  );

  // Newest profile wins: an older one may name a wallet since replaced.
  const newest = new Map<string, Event>();
  for (const event of events) {
    const previous = newest.get(event.pubkey);
    if (!previous || event.created_at > previous.created_at) {
      newest.set(event.pubkey, event);
    }
  }

  const timeoutMs = positive(opts.lnurlTimeoutMs, DEFAULT_LNURL_TIMEOUT_MS);
  await Promise.all(
    missing.map(async (pubkey) => {
      const nostrPubkey = await lookupProvider(newest.get(pubkey), timeoutMs);
      providerCache.set(pubkey, {
        nostrPubkey,
        expiresAt: Date.now() + PROVIDER_TTL_MS,
      });
      resolved.set(pubkey, nostrPubkey);
    }),
  );
  return resolved;
}

/**
 * Read `lud16` off a kind:0 and ask that endpoint who signs its receipts.
 *
 * KNOWN GAP, inherited from both `voting/lnurl.ts` and `sentiment/engagement.ts`:
 * `lud06` (bech32 LNURL) is not decoded — that needs a bech32 dependency this
 * service does not have — so those recipients resolve to null and their
 * receipts are rejected rather than half-handled.
 */
async function lookupProvider(
  profile: Event | undefined,
  timeoutMs: number,
): Promise<string | null> {
  if (!profile) return null;
  let lud16: unknown;
  try {
    lud16 = (JSON.parse(profile.content) as { lud16?: unknown }).lud16;
  } catch {
    return null;
  }
  if (typeof lud16 !== "string" || !lud16.includes("@")) return null;

  try {
    const endpoint = await resolveLightningAddress(lud16, { timeoutMs });
    return endpoint.ok ? endpoint.value.nostrPubkey : null;
  } catch {
    // `resolveLightningAddress` returns failures rather than throwing, but a
    // route that 500s during a demo is not worth the bet.
    return null;
  }
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

function positive(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}
