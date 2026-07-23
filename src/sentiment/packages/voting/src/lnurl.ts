/**
 * LNURL-pay: the missing middle of the zap-to-vote flow.
 *
 * `zap.ts` BUILDS a kind:9734 zap request; `sentiment/engagement.ts` READS
 * kind:9735 receipts back. Between them sits the part that moves the money, and
 * nothing implemented it: turning "this pubkey is the AGAINST anchor for BIP
 * 300" into a bolt11 a wallet can pay. That is this file — NIP-57 + LUD-16:
 *
 *   1. recipient -> `lud16` (`name@domain`, off their kind:0 if not supplied)
 *   2. -> GET `https://<domain>/.well-known/lnurlp/<name>`, giving `callback`,
 *      `minSendable`, `maxSendable` (MILLISATS), `allowsNostr`, `nostrPubkey`
 *   3. -> GET `callback?amount=<millisats>&nostr=<signed zap request>`
 *   4. -> `{ "pr": "lnbc..." }`, checked against the amount we asked for.
 *
 * WE DO NOT PAY. This module returns a bolt11 and stops. Paying needs a
 * spending key and nothing in this package should ever hold one: keeping the
 * boundary here means a bug in vote plumbing can waste a round trip, never
 * sats. The caller hands the invoice to a wallet (WebLN, NWC, LND); the LN
 * provider then publishes the receipt `engagement.ts` counts as the vote.
 *
 * WHY OUR BUILDER, NOT `nip57.makeZapRequest`: the stock one emits
 * `p`/`amount`/`relays` and nothing else. `buildZapRequest` also stamps the BIP
 * hashtag, `APP_TAG` and the stance `l` tag — without them the receipt is an
 * anonymous payment rather than a vote on one side of one proposal, and no
 * later parsing can recover which. So `requestZapInvoice` routes through it.
 *
 * `allowsNostr` IS NOT OPTIONAL: an endpoint lacking it takes the payment and
 * never publishes a receipt — the sats move and the vote vanishes. We fail with
 * `nostr-unsupported` rather than fall back to a plain payment, which is all
 * such a "successful" payment would be: a silent donation. This is not
 * hypothetical; `fiatjaf@zbd.gg` advertises `allowsNostr: false` today.
 *
 * SSRF: the domain comes out of a stranger's profile, so every URL here is
 * attacker-chosen — HTTPS only, no private/loopback/link-local hosts, bounded
 * timeouts, capped bodies, redirects re-validated hop by hop. KNOWN GAP: a
 * public name resolving to a private address (DNS rebinding) is not caught;
 * catching it needs a custom DNS lookup, hence a dependency we do not have.
 *
 * Nothing here throws on remote data: every entry point returns
 * `LnurlResult<T>`, so a hostile endpoint is a typed failure and not an
 * exception thrown mid-payment.
 */
import { SimplePool, type Event, type EventTemplate } from "nostr-tools";
import { getSatoshisAmountFromBolt11 } from "nostr-tools/nip57";
import { DEFAULT_RELAYS, type Stance } from "@soft-fork-wiki/shared";
import { buildZapRequest } from "./zap.js";

/** Named failure modes. Callers switch on these; messages are for humans. */
export type LnurlErrorCode =
  | "invalid-address" | "no-lightning-address" | "insecure-url" | "blocked-host"
  | "network" | "http-status" | "invalid-response" | "lnurl-error"
  | "nostr-unsupported" | "amount-out-of-range" | "invoice-mismatch"
  | "signing-failed";

/** Carried inside a failed `LnurlResult` — returned, never thrown by us. */
export class LnurlError extends Error {
  readonly code: LnurlErrorCode;
  constructor(code: LnurlErrorCode, message: string) {
    super(message);
    this.name = "LnurlError";
    this.code = code;
  }
}

export type LnurlResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: LnurlError };

/** A validated LNURL-pay response. Bounds are MILLISATS, as LUD-06 defines. */
export interface LnurlPayEndpoint {
  /** Absolute HTTPS URL we append `?amount=&nostr=` to. */
  callback: string;
  /** LUD-06 `minSendable`, in MILLISATS. */
  minSendableMsat: number;
  /** LUD-06 `maxSendable`, in MILLISATS. */
  maxSendableMsat: number;
  /** Always true: we refuse to resolve an endpoint without it. */
  allowsNostr: true;
  /** Hex pubkey that will sign this recipient's kind:9735 receipts. */
  nostrPubkey: string;
  /** The `name@domain` we resolved through, for messages and logs. */
  lightningAddress: string;
}

export interface ZapRecipient {
  /**
   * Hex pubkey of the vote anchor. Required even alongside an address: NIP-57
   * zap requests must carry a `p` tag, and `engagement.ts` keys receipt
   * validation off it.
   */
  pubkey: string;
  /** `name@domain`. When absent we read `lud16` off the recipient's kind:0. */
  lightningAddress?: string;
}

/** Signs the kind:9734 template. Caller-supplied: no keys live in here. */
export type ZapRequestSigner = (t: EventTemplate) => Event | Promise<Event>;

export interface LnurlOptions {
  /** Per-request budget, applied per hop rather than to the whole flow. */
  timeoutMs?: number;
  /** Relays for the kind:0 lookup and the zap request's `relays` tag. */
  relays?: readonly string[];
}

export interface RequestZapInvoiceInput extends LnurlOptions {
  bipNumber: number;
  stance: Extract<Stance, "favour" | "against">;
  recipient: ZapRecipient;
  /** Amount in SATS — the unit humans read. Converted to msat internally. */
  amountSats: number;
  comment?: string;
  /** The stance anchor note being zapped, when the vote targets a note. */
  zappedEventId?: string;
  createdAt?: number;
  signer: ZapRequestSigner;
}

/** An invoice ready to pay, plus the evidence that it was checked. */
export interface ZapInvoice {
  /** bolt11 to hand to a wallet. NOT paid by this module. */
  bolt11: string;
  /** Amount confirmed present inside the invoice, in SATS. */
  amountSats: number;
  /** The same amount in MILLISATS, as sent to the callback. */
  amountMsat: number;
  endpoint: LnurlPayEndpoint;
  /** The signed kind:9734 we handed over; its id links to the receipt. */
  zapRequest: Event;
}

const DEFAULT_TIMEOUT_MS = 8_000;
/** LNURL responses are small JSON blobs; anything larger is not one. */
const MAX_BODY_BYTES = 64 * 1024;
/** Enough for the usual apex/www normalisation, not enough to be a maze. */
const MAX_REDIRECTS = 3;
/** Sent on every request; see the note in `fetchJson`. */
const USER_AGENT = "soft-fork-wiki/0.1";
const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Resolve `name@domain` to its LNURL-pay endpoint (LUD-16).
 *
 * Deliberately the same walk `engagement.ts` uses to learn who may sign a
 * receipt — same well-known path, same `allowsNostr`/`nostrPubkey` demand — so
 * an address payable here is one whose receipts will count there.
 */
export async function resolveLightningAddress(
  address: string,
  opts: LnurlOptions = {},
): Promise<LnurlResult<LnurlPayEndpoint>> {
  const trimmed = typeof address === "string" ? address.trim() : "";
  const [name, domain, ...rest] = trimmed.split("@");
  if (!name || !domain || rest.length > 0) {
    return fail("invalid-address", `not a lightning address: "${sanitise(address)}"`);
  }
  let url: string;
  try {
    url = new URL(`/.well-known/lnurlp/${encodeURIComponent(name)}`, `https://${domain}`).toString();
  } catch {
    return fail("invalid-address", `bad lightning address domain: "${sanitise(domain)}"`);
  }
  const body = await fetchJson(url, timeoutOf(opts));
  return body.ok ? parseLnurlPay(body.value, trimmed) : body;
}

/**
 * Resolve a recipient: their supplied address, else the `lud16` on their kind:0.
 *
 * KNOWN GAP, shared with `engagement.ts`: `lud06` (bech32 LNURL) is not decoded
 * — that needs a bech32 dependency this package does not have. Such a recipient
 * fails with `no-lightning-address` rather than being half-handled.
 */
export async function resolveZapEndpoint(
  recipient: ZapRecipient,
  opts: LnurlOptions = {},
): Promise<LnurlResult<LnurlPayEndpoint>> {
  if (recipient?.lightningAddress) {
    return resolveLightningAddress(recipient.lightningAddress, opts);
  }
  const pubkey = String(recipient?.pubkey);
  if (!HEX64.test(pubkey)) {
    return fail("invalid-address", "recipient needs a 64-char hex pubkey or a lightning address");
  }

  const relays = [...(opts.relays ?? DEFAULT_RELAYS)];
  const pool = new SimplePool();
  let profiles: Event[] = [];
  try {
    const filter = { kinds: [0], authors: [pubkey] };
    profiles = await pool.querySync(relays, filter, { maxWait: timeoutOf(opts) });
  } catch {
    profiles = []; // A dead relay is an unresolved recipient, not a thrown flow.
  } finally {
    pool.close(relays);
  }

  // Newest profile wins: an older one may name a wallet since replaced.
  let newest: Event | undefined;
  for (const profile of profiles) {
    if (!newest || profile.created_at > newest.created_at) newest = profile;
  }
  if (!newest) return fail("no-lightning-address", `no kind:0 found for ${pubkey}`);

  let lud16: unknown;
  try {
    lud16 = (JSON.parse(newest.content) as { lud16?: unknown }).lud16;
  } catch {
    return fail("no-lightning-address", `unparseable kind:0 for ${pubkey}`);
  }
  if (typeof lud16 !== "string" || !lud16.includes("@")) {
    return fail("no-lightning-address", `no lud16 on the kind:0 for ${pubkey}`);
  }
  return resolveLightningAddress(lud16, opts);
}

/**
 * Ask the callback for an invoice, and prove it bills what we asked for.
 *
 * That last check stands between "you zapped 1,000 sats" and a wallet being
 * handed an invoice for 100,000: the amount inside the bolt11 is signed by the
 * payee and is what a wallet will really pay, while the `amount` we sent was
 * only a request.
 */
export async function fetchZapInvoice(
  endpoint: LnurlPayEndpoint,
  amountSats: number,
  zapRequest: Event,
  opts: LnurlOptions = {},
): Promise<LnurlResult<ZapInvoice>> {
  const amount = checkAmount(amountSats, endpoint);
  if (!amount.ok) return amount;
  const amountMsat = amount.value;

  let url: URL;
  try {
    url = new URL(endpoint.callback);
    url.searchParams.set("amount", String(amountMsat)); // MILLISATS, per LUD-06.
    // `set` percent-encodes the JSON for us; the server URI-decodes it back to
    // the exact bytes it must embed in the receipt's `description` tag.
    url.searchParams.set("nostr", JSON.stringify(zapRequest));
  } catch {
    return fail("invalid-response", `unusable callback URL: "${sanitise(endpoint.callback)}"`);
  }

  const body = await fetchJson(url.toString(), timeoutOf(opts));
  if (!body.ok) return body;
  if (!body.value || typeof body.value !== "object") {
    return fail("invalid-response", "callback did not return a JSON object");
  }
  const payload = body.value as Record<string, unknown>;
  if (String(payload.status).toUpperCase() === "ERROR") {
    return fail("lnurl-error", `callback refused: "${sanitise(payload.reason)}"`);
  }
  const bolt11 = typeof payload.pr === "string" ? payload.pr.trim() : "";
  if (!bolt11) return fail("invalid-response", "callback returned no `pr` invoice");

  // `getSatoshisAmountFromBolt11` returns 0 for amountless AND for unparseable
  // invoices. Either way we cannot prove what a wallet would pay, so 0 is a
  // failure here and never a zero-sat zap.
  let invoiceSats = 0;
  try {
    invoiceSats = getSatoshisAmountFromBolt11(bolt11);
  } catch {
    invoiceSats = 0;
  }
  if (!Number.isFinite(invoiceSats) || invoiceSats <= 0) {
    return fail("invoice-mismatch", `invoice carries no amount (we asked for ${amountSats} sats); ` +
      `an amountless invoice would let the payer choose the vote weight`);
  }
  if (invoiceSats !== amountSats) {
    return fail("invoice-mismatch",
      `invoice bills ${invoiceSats} sats but we asked for ${amountSats} sats`);
  }
  return { ok: true, value: { bolt11, amountSats, amountMsat, endpoint, zapRequest } };
}

/**
 * End to end: BIP + stance + recipient + sats -> a payable, verified invoice.
 *
 * Resolve before signing: no point asking a user's key to sign a request for an
 * amount the endpoint was never going to accept. Does NOT pay the invoice.
 */
export async function requestZapInvoice(
  input: RequestZapInvoiceInput,
): Promise<LnurlResult<ZapInvoice>> {
  if (typeof input?.signer !== "function") {
    return fail("signing-failed", "a signer is required; this module holds no keys");
  }
  // Checked before the network so a nonsense amount costs no round trip; the
  // range check repeats once the endpoint's bounds are known.
  const amount = checkAmount(input.amountSats);
  if (!amount.ok) return amount;

  const relays = [...(input.relays ?? DEFAULT_RELAYS)];
  const endpoint = await resolveZapEndpoint(input.recipient, {
    timeoutMs: input.timeoutMs,
    relays,
  });
  if (!endpoint.ok) return endpoint;
  const ranged = checkAmount(input.amountSats, endpoint.value);
  if (!ranged.ok) return ranged;

  // Our builder, not `nip57.makeZapRequest` — see the file header.
  const template = buildZapRequest({
    bipNumber: input.bipNumber,
    stance: input.stance,
    recipientPubkey: input.recipient.pubkey,
    amountMsat: ranged.value, // SATS -> MILLISATS, per NIP-57's `amount` tag.
    relays,
    zappedEventId: input.zappedEventId,
    createdAt: input.createdAt ?? Math.floor(Date.now() / 1000),
    comment: input.comment,
  });

  let signed: Event;
  try {
    signed = await input.signer(template);
  } catch (err) {
    return fail("signing-failed", `signer threw: "${sanitise(describe(err))}"`);
  }
  if (!signed || !HEX64.test(String(signed.id)) || typeof signed.sig !== "string") {
    return fail("signing-failed", "signer returned something that is not a signed event");
  }
  return fetchZapInvoice(endpoint.value, input.amountSats, signed, {
    timeoutMs: input.timeoutMs,
  });
}

/**
 * SATS -> MILLISATS, and (given an endpoint) the bounds check.
 *
 * The only place that conversion is written. Bounds are msat but the message
 * quotes SATS, because sats is what a human reads; the range is rounded inwards
 * so the numbers quoted are ones the endpoint really accepts.
 */
function checkAmount(
  amountSats: number,
  endpoint?: LnurlPayEndpoint,
): LnurlResult<number> {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    return fail("amount-out-of-range",
      `amount must be a positive whole number of sats, got "${sanitise(amountSats)}"`);
  }
  const amountMsat = amountSats * 1000;
  if (endpoint && (amountMsat < endpoint.minSendableMsat || amountMsat > endpoint.maxSendableMsat)) {
    return fail("amount-out-of-range",
      `${amountSats} sats is outside ${endpoint.lightningAddress}'s accepted range of ` +
        `${Math.ceil(endpoint.minSendableMsat / 1000)}-` +
        `${Math.floor(endpoint.maxSendableMsat / 1000)} sats`);
  }
  return { ok: true, value: amountMsat };
}

/** Validate an LNURL-pay response body. Every field is attacker-controlled. */
function parseLnurlPay(body: unknown, address: string): LnurlResult<LnurlPayEndpoint> {
  if (!body || typeof body !== "object") {
    return fail("invalid-response", `${address} did not return a JSON object`);
  }
  const raw = body as Record<string, unknown>;
  if (String(raw.status).toUpperCase() === "ERROR") {
    return fail("lnurl-error", `${address} refused: "${sanitise(raw.reason)}"`);
  }
  if (raw.tag !== "payRequest") {
    return fail("invalid-response",
      `${address} is not an LNURL-pay endpoint (tag: "${sanitise(raw.tag)}")`);
  }
  const callback = typeof raw.callback === "string" ? raw.callback : "";
  const guard = checkUrl(callback);
  if (guard) return { ok: false, error: guard };

  const minSendableMsat = Number(raw.minSendable);
  const maxSendableMsat = Number(raw.maxSendable);
  if (!Number.isFinite(minSendableMsat) || !Number.isFinite(maxSendableMsat) ||
      minSendableMsat <= 0 || maxSendableMsat < minSendableMsat) {
    return fail("invalid-response", `${address} advertises a nonsensical sendable range`);
  }

  // The whole reason to zap rather than pay: no receipt, no vote.
  const nostrPubkey = typeof raw.nostrPubkey === "string" ? raw.nostrPubkey.trim() : "";
  if (raw.allowsNostr !== true || !HEX64.test(nostrPubkey)) {
    return fail("nostr-unsupported",
      `${address} does not support nostr zaps (allowsNostr: "${sanitise(raw.allowsNostr)}", ` +
        `nostrPubkey: "${sanitise(raw.nostrPubkey)}") — it would take the payment without ` +
        `publishing a kind:9735 receipt, so the sats would move and the vote would vanish`);
  }

  return {
    ok: true,
    value: {
      callback,
      minSendableMsat,
      maxSendableMsat,
      allowsNostr: true,
      nostrPubkey: nostrPubkey.toLowerCase(),
      lightningAddress: address,
    },
  };
}

/**
 * GET JSON with every guard on: HTTPS only, no private hosts, hard timeout,
 * capped body, and redirects followed by hand so each hop is re-validated.
 * (`redirect: "manual"` surfaces the real 3xx under Node/undici, which is why
 * this module is Node-first rather than browser-portable.)
 */
async function fetchJson(url: string, timeoutMs: number): Promise<LnurlResult<unknown>> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const guard = checkUrl(target);
    if (guard) return { ok: false, error: guard };

    let response: Response;
    try {
      response = await fetch(target, {
        redirect: "manual",
        // Node sends no User-Agent by default and some providers read that as a
        // bot: getalby.com answers 429 to a UA-less request and 200 to the same
        // request with any UA at all. Measured, not guessed.
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return fail("network", `request failed: "${sanitise(describe(err))}"`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return fail("network", `redirect with no location (${response.status})`);
      try {
        target = new URL(location, target).toString();
      } catch {
        return fail("network", `unusable redirect target: "${sanitise(location)}"`);
      }
      continue; // Re-checked at the top: an http:// or 127.0.0.1 hop dies there.
    }
    if (!response.ok) return fail("http-status", `endpoint returned HTTP ${response.status}`);

    const text = await readCapped(response, MAX_BODY_BYTES);
    if (text === null) {
      return fail("invalid-response", `response body unreadable or over ${MAX_BODY_BYTES} bytes`);
    }
    try {
      return { ok: true, value: JSON.parse(text) as unknown };
    } catch {
      return fail("invalid-response", "response was not JSON");
    }
  }
  return fail("network", `more than ${MAX_REDIRECTS} redirects`);
}

/** Read at most `maxBytes`; null on overflow or a broken stream. */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      // Stop pulling rather than buffer an endless "JSON" body into memory.
      if (size > maxBytes) return null;
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * HTTPS-only, public-host-only URL check — the SSRF sink of this module.
 * Without it a profile carrying `lud16: "x@127.0.0.1"` points our fetch at
 * whatever is listening on the machine running the resolver.
 */
function checkUrl(raw: string): LnurlError | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return new LnurlError("invalid-response", `not a URL: "${sanitise(raw)}"`);
  }
  if (url.protocol !== "https:") {
    return new LnurlError("insecure-url", `only https is allowed, got "${url.protocol}"`);
  }
  if (isBlockedHost(url.hostname)) {
    return new LnurlError("blocked-host",
      `refusing to fetch a private or loopback host: "${sanitise(url.hostname)}"`);
  }
  return null;
}

/** Loopback, RFC1918, CGNAT, link-local, multicast and internal-only names. */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost") ||
      host.endsWith(".internal") || host.endsWith(".home.arpa")) {
    return true;
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true; // this-host, RFC1918, loopback
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 169 && b === 254) return true; // 169.254/16 link-local (cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  if (host.includes(":")) {
    if (host === "::1" || host === "::") return true; // loopback / unspecified
    if (/^f[cd]/.test(host)) return true; // fc00::/7 unique-local
    if (/^fe[89ab]/.test(host)) return true; // fe80::/10 link-local
    if (host.startsWith("::ffff:")) return true; // IPv4-mapped: refuse, do not re-parse
    return false;
  }
  return false;
}

/**
 * Make remote text safe to put in an error message. A `reason` is
 * attacker-written, and raw C0/C1 bytes in one can smuggle ANSI escapes or
 * newlines into a log line and forge entries around ours. Compared by code
 * point rather than matched by a regex, so no control character ever has to
 * appear in this source file.
 */
function sanitise(value: unknown, max = 160): string {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  let stripped = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    stripped += cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) ? " " : ch;
  }
  const cleaned = stripped.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}...` : cleaned;
}

function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function fail<T>(code: LnurlErrorCode, message: string): LnurlResult<T> {
  return { ok: false, error: new LnurlError(code, message) };
}

function timeoutOf(opts: LnurlOptions): number {
  const ms = opts?.timeoutMs;
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0
    ? Math.floor(ms)
    : DEFAULT_TIMEOUT_MS;
}
