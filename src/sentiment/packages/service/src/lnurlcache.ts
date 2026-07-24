/**
 * A process-wide memo for LNURL-pay endpoint lookups.
 *
 * ## WHY THIS EXISTS, AND WHY IT IS A `fetch` WRAPPER
 *
 * Zap trust is not negotiable: a kind:9735 receipt only counts if it was signed
 * by the `nostrPubkey` that the RECIPIENT'S OWN LNURL-pay endpoint advertises
 * (see `zaptrust.ts` and `sentiment/engagement.ts`). That check costs one HTTPS
 * GET per distinct recipient, and it is the single slowest thing in the zaps
 * path: MEASURED at ~7s for 34 recipients in an earlier run, and ~9.6s of a
 * 13s cold request here.
 *
 * It is also almost entirely repeated work. Zap receipts are signed by Lightning
 * CUSTODIANS, not by individuals — in a live sample only ~14 distinct pubkeys
 * signed 139 receipts — and the same custodians recur across every BIP. So the
 * lookup should be paid once per process, not once per request per BIP.
 *
 * `zaptrust.ts` already memoises its own `pubkey -> nostrPubkey` map. The other
 * half of the work happens inside `sentiment/engagement.ts`, which resolves
 * providers per CALL and which this task may not modify. Its only seam is the
 * HTTPS request itself, so that is what we cache: a wrapper around `globalThis
 * .fetch` that memoises GETs to `/.well-known/lnurlp/<name>` — the exact path
 * both `engagement.ts` and `voting/lnurl.ts` build. One URL is one lightning
 * address is one recipient, so caching by URL is caching by recipient.
 *
 * ## WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not weaken any check. The response a caller gets on a hit is byte-for
 * -byte the one the endpoint served, replayed; `allowsNostr`, `nostrPubkey`,
 * the SSRF guards in `voting/lnurl.ts` and the signature checks in
 * `zaptrust.ts`/`engagement.ts` all still run on it. A forged receipt is
 * rejected exactly as before — the cache only removes the round trip.
 *
 * It touches nothing else. Any request that is not a GET, or whose path is not
 * an LNURL-pay well-known, is handed to the original `fetch` untouched — so LLM
 * provider calls, relay HTTP, and everything else behave as if this module did
 * not exist.
 *
 * ## FRESHNESS
 *
 * A wallet's `nostrPubkey` changes when the user moves custodian, which is rare
 * and (per NIP-57) invalidates old receipts anyway. `ENTRY_TTL_MS` of one hour
 * is far longer than any demo and far shorter than "forever". Failures — a
 * timeout, a 502, a TLS error — are cached too but only for `FAILURE_TTL_MS`,
 * because re-paying a 6-second timeout on every poll of the gauge is exactly the
 * cost this module exists to remove, while a permanently cached outage would
 * keep rejecting a recipient who came back online.
 *
 * Single-flight: two concurrent validators asking for the same endpoint share
 * one request rather than racing to fill the same slot. The discussion path runs
 * `fetchEngagement` and the distinct-zapper pass at the same time over the same
 * recipients, so this is the common case, not an edge case.
 */

/** How long a resolved endpoint response is replayed. Wallets move rarely. */
const ENTRY_TTL_MS = 60 * 60 * 1000;

/** How long a failed lookup is remembered, so a timeout is paid once, briefly. */
const FAILURE_TTL_MS = 2 * 60 * 1000;

/**
 * Hard bound on retained entries. The demo touches tens of custodians, so this
 * is never reached in practice; it exists so a long-running process cannot grow
 * this map without limit. Clearing wholesale rather than evicting one entry is
 * fine at this size and keeps the code honest about being a memo, not an LRU.
 */
const MAX_ENTRIES = 1_000;

/** The path both `engagement.ts` and `voting/lnurl.ts` build from a `lud16`. */
const LNURL_PAY_PATH = "/.well-known/lnurlp/";

/** Statuses that MUST NOT carry a body when replayed. */
const BODYLESS_STATUSES = new Set([101, 204, 205, 304]);

/**
 * A captured outcome. Errors are recorded rather than thrown so that the stored
 * promise never rejects — a rejected promise sitting in a map is an unhandled
 * rejection waiting for the next GC.
 */
type Snapshot =
  | {
      kind: "response";
      status: number;
      statusText: string;
      headers: [string, string][];
      body: string;
    }
  | { kind: "error"; message: string };

interface Entry {
  result: Promise<Snapshot>;
  /** Infinity while in flight; set once the outcome is known. */
  expiresAt: number;
}

/**
 * The argument types of whichever `fetch` this runtime provides.
 *
 * Derived from `typeof fetch` rather than written as `RequestInfo | URL`: under
 * `@types/node` the global `fetch` is undici's, and the DOM's `RequestInfo` name
 * is not in scope. Deriving keeps the wrapper's signature identical to the thing
 * it replaces, whichever that is.
 */
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export interface LnurlCacheStats {
  /** True once `installLnurlCache()` has replaced `globalThis.fetch`. */
  installed: boolean;
  /** Distinct endpoints held. */
  entries: number;
  /** Lookups served without an HTTPS round trip. */
  hits: number;
  /** Lookups that had to go out to the network. */
  misses: number;
}

const cache = new Map<string, Entry>();
let originalFetch: typeof fetch | null = null;
let hits = 0;
let misses = 0;

/**
 * Replace `globalThis.fetch` with the memoising wrapper. Idempotent: calling it
 * twice does not stack two wrappers, so it is safe to call from any entry point
 * rather than needing a single blessed one.
 */
export function installLnurlCache(): void {
  if (originalFetch) return;
  const base = globalThis.fetch;
  if (typeof base !== "function") return;
  originalFetch = base.bind(globalThis) as typeof fetch;
  globalThis.fetch = memoisingFetch as typeof fetch;
}

/** Drop every memoised endpoint. For tests and for a manual cache bust. */
export function clearLnurlCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
}

/** Current counters, surfaced on `/health` and in the sentiment payload. */
export function lnurlCacheStats(): LnurlCacheStats {
  return { installed: originalFetch !== null, entries: cache.size, hits, misses };
}

async function memoisingFetch(
  input: FetchInput,
  init?: FetchInit,
): Promise<Response> {
  const passthrough = originalFetch;
  // Defensive: `memoisingFetch` is only ever installed alongside `originalFetch`,
  // but a partially torn-down module must not turn a lookup into a crash.
  if (!passthrough) throw new Error("lnurl cache used before install");

  const url = requestUrl(input);
  if (!url || methodOf(input, init) !== "GET" || !isLnurlPay(url)) {
    return passthrough(input, init);
  }

  const now = Date.now();
  const hit = cache.get(url);
  if (hit && hit.expiresAt > now) {
    hits += 1;
    return replay(await hit.result);
  }

  misses += 1;
  if (cache.size >= MAX_ENTRIES) cache.clear();
  const entry: Entry = {
    result: capture(passthrough, url, init),
    expiresAt: Number.POSITIVE_INFINITY,
  };
  cache.set(url, entry);

  const snapshot = await entry.result;
  entry.expiresAt =
    Date.now() + (snapshot.kind === "response" ? ENTRY_TTL_MS : FAILURE_TTL_MS);
  return replay(snapshot);
}

/**
 * Perform the request and freeze everything a replay needs.
 *
 * The body is drained to a string here because a `Response` body is a
 * single-use stream: handing the same `Response` object to two callers would
 * give the second one an empty body. Never rejects.
 */
async function capture(
  passthrough: typeof fetch,
  url: string,
  init: FetchInit,
): Promise<Snapshot> {
  try {
    const response = await passthrough(url, init);
    return {
      kind: "response",
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()],
      body: BODYLESS_STATUSES.has(response.status) ? "" : await response.text(),
    };
  } catch (err) {
    return { kind: "error", message: describe(err) };
  }
}

/**
 * Rebuild a `Response` from a snapshot, or rethrow the captured failure.
 *
 * A fresh `Response` per caller is required, not an optimisation: `voting/lnurl
 * .ts` reads the body through `getReader()` and would consume a shared one.
 */
function replay(snapshot: Snapshot): Response {
  if (snapshot.kind === "error") throw new Error(snapshot.message);
  return new Response(
    BODYLESS_STATUSES.has(snapshot.status) ? null : snapshot.body,
    {
      status: snapshot.status,
      statusText: snapshot.statusText,
      headers: snapshot.headers,
    },
  );
}

/** True for `https://host/.well-known/lnurlp/<name>` and nothing else. */
function isLnurlPay(url: string): boolean {
  try {
    return new URL(url).pathname.startsWith(LNURL_PAY_PATH);
  } catch {
    return false;
  }
}

function requestUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (input && typeof input === "object" && typeof input.url === "string") {
    return input.url;
  }
  return "";
}

/**
 * The effective method. `init.method` wins over a `Request`'s own, matching
 * what `fetch` itself does, and an absent method is GET per the spec.
 */
function methodOf(input: FetchInput, init: FetchInit): string {
  const fromInit = typeof init?.method === "string" ? init.method : "";
  if (fromInit) return fromInit.toUpperCase();
  if (
    input &&
    typeof input === "object" &&
    !(input instanceof URL) &&
    typeof input.method === "string"
  ) {
    return input.method.toUpperCase();
  }
  return "GET";
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
