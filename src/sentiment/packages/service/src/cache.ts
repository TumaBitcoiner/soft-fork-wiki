/**
 * A TTL cache with single-flight semantics.
 *
 * Analyzing a BIP is network-bound *and* costs one LLM call per note, so the
 * expensive part of this service is doing the same work twice. Two things
 * guard against that:
 *
 *  1. A fresh result is served from memory until its TTL expires.
 *  2. While a load is in flight, every other caller for the same key gets the
 *     *same promise* rather than starting a second run. Without this, three
 *     browser tabs opening BIP 110 at once would triple the token spend.
 *
 * Failures are intentionally not cached: a relay hiccup or a rate-limited key
 * should not poison the entry for the whole TTL, so the next request retries.
 *
 * In-memory only — one process, no eviction beyond TTL. That is right for a
 * handful of BIPs; if this ever fronts the full BIP catalogue, add an LRU bound.
 */

interface Entry<V> {
  value: V;
  /** Epoch millis after which the value is stale. */
  expiresAt: number;
}

export interface CacheStats {
  /** Entries currently held (fresh or stale-but-not-yet-evicted). */
  entries: number;
  /** Loads currently running. */
  inflight: number;
}

export class SingleFlightCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();
  private readonly inflight = new Map<K, Promise<V>>();

  /** @param ttlMs how long a resolved value stays fresh. 0 disables caching. */
  constructor(private readonly ttlMs: number) {}

  /**
   * Return the cached value, join an in-flight load, or start one.
   *
   * Deliberately not `async`: returning the stored promise object itself is
   * what makes concurrent callers share a single run.
   */
  get(key: K, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const run = load()
      .then((value) => {
        if (this.ttlMs > 0) {
          this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        }
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, run);
    return run;
  }

  /** Drop a cached value so the next `get` recomputes. In-flight loads survive. */
  invalidate(key: K): void {
    this.entries.delete(key);
  }

  stats(): CacheStats {
    return { entries: this.entries.size, inflight: this.inflight.size };
  }
}
