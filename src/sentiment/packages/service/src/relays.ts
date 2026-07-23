/**
 * One long-lived relay pool for the process, and every read bounded by a clock.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The zaps-and-votes sentiment path has a hard latency budget: the gauge is
 * supposed to move within seconds of somebody zapping, on a two-minute demo
 * slot. Two things dominate that budget, and neither is arithmetic.
 *
 *  1. **TLS + WebSocket handshakes.** `voting/NostrClient` builds a fresh
 *     `SimplePool` per call and closes it in a `finally`, so every request pays
 *     four cold connections. Measured here that is the difference between a
 *     ~2s first read and a ~200ms warm one. We cannot change `NostrClient`
 *     (it lives in another package), so the fast path owns a pool that stays
 *     up between requests and is warmed at boot.
 *
 *  2. **Waiting for the slowest relay.** `NostrClient.query` passes no
 *     `maxWait`, so `querySync` only settles when *every* relay has sent EOSE
 *     or dropped. One wedged relay therefore sets the response time. Here every
 *     read carries a `Deadline`, and `querySync` hands back whatever arrived
 *     when the clock runs out. A partial answer marked `degraded` beats a
 *     spinner in front of an audience.
 *
 * Nothing in here throws. A relay that refuses, times out, or returns junk is a
 * missing signal, and the caller renders zeros — the demo must never 500.
 *
 * The pool is module-level rather than injected because it is process-wide
 * shared state by nature (a socket per relay); `closeRelayPool()` exists so a
 * test or a shutdown handler can let the event loop drain.
 */
import { SimplePool, type Event, type Filter } from "nostr-tools";
import { DEFAULT_RELAYS } from "@soft-fork-wiki/shared";

/** Never wait less than this for a relay; below it, nothing ever answers. */
const MIN_WAIT_MS = 120;

/**
 * Per-relay connect budget during warmup.
 *
 * Generous on purpose: warmup is fire-and-forget at boot, so a slow relay costs
 * nothing here, whereas a relay that fails to warm makes the FIRST request pay
 * the handshake. Measured: relay.damus.io needs 1.3s+ to connect, and a 3s
 * warmup window missed it often enough to matter.
 */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * How long a relay socket may sit unused before `SimplePool` closes it.
 *
 * The library default is 20 SECONDS, which quietly defeats the whole point of a
 * shared pool: a demo that pauses for half a minute between clicks pays the
 * handshakes again on the next click, and `maxWait` does not cover connect time
 * (nostr-tools starts the EOSE timer only once the subscription exists), so
 * that shows up as a multi-second response the budget cannot cap. Ten minutes
 * outlives any demo. Four idle WebSockets is a rounding error of a cost.
 */
const IDLE_TIMEOUT_MS = 10 * 60 * 1_000;

let pool: SimplePool | null = null;
/** Relay set the live pool is connected to, so a config change rebuilds it. */
let poolKey = "";

/** Normalise a relay override down to the list we actually connect to. */
export function relayList(relays?: readonly string[]): string[] {
  const list = [...(relays ?? DEFAULT_RELAYS)]
    .map((r) => (typeof r === "string" ? r.trim() : ""))
    .filter((r) => r.length > 0);
  return list.length > 0 ? list : [...DEFAULT_RELAYS];
}

/**
 * The shared pool for `relays`.
 *
 * Rebuilt only if the relay set changes, which in practice happens never — the
 * set is read from env once at boot. Keeping the check makes a second caller
 * with a different override correct rather than silently reading the wrong
 * relays.
 */
function ensurePool(relays: readonly string[]): SimplePool {
  const key = relays.join(",");
  if (pool && key === poolKey) return pool;
  if (pool) {
    try {
      pool.close([...poolKey.split(",")].filter((r) => r.length > 0));
    } catch {
      // Closing a pool that already lost its sockets is not an error.
    }
  }
  // `enableReconnect` so a socket dropped by a relay restart comes back on its
  // own; `enablePing` so a NAT or proxy does not silently blackhole an idle one
  // and leave us waiting on a connection that is already dead.
  pool = new SimplePool({ enableReconnect: true, enablePing: true });
  // Assigned rather than passed: `SimplePool`'s constructor only forwards
  // `enablePing`/`enableReconnect`, and `idleTimeout` is read when each relay
  // object is built — so this must happen before the first `ensureRelay`.
  pool.idleTimeout = IDLE_TIMEOUT_MS;
  poolKey = key;
  return pool;
}

/**
 * Open the sockets before anyone asks for data.
 *
 * Called at boot so the first `GET /sentiment/:bip` of the demo is a warm read
 * rather than the one that pays for four TLS handshakes. Failures are ignored:
 * a relay that is down at boot may be up by the first request, and `querySync`
 * will try again anyway.
 */
export async function warmRelays(relays?: readonly string[]): Promise<string[]> {
  const list = relayList(relays);
  const target = ensurePool(list);
  const connected: string[] = [];
  await Promise.all(
    list.map(async (url) => {
      try {
        await target.ensureRelay(url, { connectionTimeout: CONNECT_TIMEOUT_MS });
        connected.push(url);
      } catch {
        // Unreachable right now. Not fatal, not worth a stack trace.
      }
    }),
  );
  return connected;
}

/** Drop the shared sockets so a test process or a shutdown can exit. */
export function closeRelayPool(): void {
  if (!pool) return;
  try {
    pool.close(poolKey.split(",").filter((r) => r.length > 0));
  } catch {
    // Already gone.
  }
  pool = null;
  poolKey = "";
}

/**
 * A shared wall-clock budget for a whole request.
 *
 * Passed down instead of a per-query timeout so that two sequential hops (find
 * the poll, then read its responses) cannot each spend the full budget and
 * double the response time. Whatever hop one leaves is what hop two gets.
 */
export class Deadline {
  private constructor(private readonly at: number) {}

  /** A budget of `ms` from now. Non-positive input yields an expired budget. */
  static in(ms: number): Deadline {
    const budget = Number.isFinite(ms) && ms > 0 ? ms : 0;
    return new Deadline(Date.now() + budget);
  }

  /** Milliseconds left, floored at 0. */
  remaining(): number {
    return Math.max(0, this.at - Date.now());
  }

  expired(): boolean {
    return this.remaining() <= 0;
  }

  /**
   * A sub-budget worth `fraction` of what is left, never longer than what is
   * left.
   *
   * Two sequential hops share one budget, so hop one must not be allowed to
   * spend all of it — otherwise a slow relay on the first read leaves the
   * second read no time and silently drops the poll responses. Slicing is how
   * "2.5 seconds total" stays 2.5 seconds total instead of 2.5 per hop.
   */
  slice(fraction: number): Deadline {
    const share = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 1;
    return new Deadline(Date.now() + this.remaining() * share);
  }
}

export interface RelayReadResult {
  events: Event[];
  /**
   * True when at least one relay did not finish within the budget, so this
   * event set may be short.
   *
   * EXPECT THIS TO BE TRUE with the default relay set. Measured: for a `#t`
   * filter, `nostr.wine`, `relay.primal.net` and `nos.lol` reach EOSE in
   * 50-280ms while `relay.damus.io` takes 1.8-4.4s — and per the note in
   * `shared/nostr.ts` damus returns nothing for `#t` lookups anyway. Waiting
   * for it would set the response time of the whole product, so we cut it off.
   *
   * Because of that, callers aggregating several reads should NOT surface this
   * directly; `opinions.ts` reports a response as degraded only when `answered`
   * came back empty across every read. Use `answered`/`incomplete` for detail.
   */
  degraded: boolean;
  /** Relays that reached EOSE inside the budget. */
  answered: string[];
  /** Relays still streaming, or failed, when the clock ran out. */
  incomplete: string[];
}

/**
 * Run one filter against every relay, in parallel, capped by `deadline`.
 *
 * One `querySync` per relay rather than one call listing them all. The wire
 * traffic is identical — `SimplePool` opens a subscription per relay either way
 * — but a multi-relay `querySync` resolves as a unit, so we would learn only
 * "something was slow" and not which. Per-relay lets us report `answered` and
 * `incomplete` truthfully, which is the difference between a demo operator
 * seeing "3 of 4 relays, damus is lagging" and seeing an unexplained zero.
 *
 * Events are deduplicated by id, since relays overlap by design.
 *
 * Never throws. A relay that refuses, times out, or returns junk is counted as
 * incomplete and stepped over.
 */
export async function readRelays(
  filter: Filter,
  relays: readonly string[],
  deadline: Deadline,
): Promise<RelayReadResult> {
  const list = relayList(relays);
  const remaining = deadline.remaining();
  // Out of time before we started: report the miss instead of firing a query
  // whose answer nobody is waiting for.
  if (remaining <= 0) {
    return { events: [], degraded: true, answered: [], incomplete: [...list] };
  }

  const target = ensurePool(list);
  const maxWait = Math.max(MIN_WAIT_MS, remaining);
  const byId = new Map<string, Event>();
  const answered: string[] = [];
  const incomplete: string[] = [];

  await Promise.all(
    list.map(async (url) => {
      const startedAt = Date.now();

      // Connect explicitly first. `querySync` swallows an unreachable relay: it
      // resolves with an empty array almost instantly, which is indistinguishable
      // from "answered, nothing matched" and would let a completely dead relay
      // set report `degraded: false` next to a fabricated-looking zero. Measured
      // with two bogus relay URLs, that is exactly what happened. `ensureRelay`
      // is the only call that surfaces the failure, and it is a no-op on a
      // socket that is already up.
      try {
        await target.ensureRelay(url, { connectionTimeout: maxWait });
      } catch {
        incomplete.push(url);
        return;
      }

      // Connecting spends the same budget the query does; never let the two add
      // up to twice the deadline.
      const left = maxWait - (Date.now() - startedAt);
      if (left <= 0) {
        incomplete.push(url);
        return;
      }

      const queryStartedAt = Date.now();
      try {
        const events = await target.querySync([url], filter, { maxWait: left });
        for (const event of events) {
          if (event && typeof event.id === "string") byId.set(event.id, event);
        }
        // `querySync` resolves either at EOSE or when `maxWait` fires, and only
        // the clock can tell those apart.
        if (Date.now() - queryStartedAt >= left) incomplete.push(url);
        else answered.push(url);
      } catch {
        incomplete.push(url);
      }
    }),
  );

  return {
    events: [...byId.values()],
    degraded: incomplete.length > 0,
    answered,
    incomplete,
  };
}
