/**
 * Thin relay-pool wrapper over nostr-tools, shared by opinion + zap flows.
 */
import { SimplePool, type Event, type Filter } from "nostr-tools";
import { DEFAULT_RELAYS } from "@soft-fork-wiki/shared";

export interface NostrClientOptions {
  relays?: readonly string[];
}

export class NostrClient {
  private pool = new SimplePool();
  readonly relays: string[];

  constructor(opts: NostrClientOptions = {}) {
    this.relays = [...(opts.relays ?? DEFAULT_RELAYS)];
  }

  /** Publish a signed event to all relays; resolves once at least one accepts. */
  async publish(event: Event): Promise<void> {
    await Promise.any(this.pool.publish(this.relays, event));
  }

  /** Fetch all events matching a filter (closes on EOSE). */
  async query(filter: Filter): Promise<Event[]> {
    return this.pool.querySync(this.relays, filter);
  }

  /** Live subscription; returns an unsubscribe function. */
  subscribe(filter: Filter, onEvent: (e: Event) => void): () => void {
    const sub = this.pool.subscribeMany(this.relays, filter, {
      onevent: onEvent,
    });
    return () => sub.close();
  }

  close(): void {
    this.pool.close(this.relays);
  }
}
