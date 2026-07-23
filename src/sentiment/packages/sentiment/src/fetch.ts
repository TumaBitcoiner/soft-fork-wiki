/**
 * Fetch public Nostr notes that discuss a given BIP.
 *
 * We query kind:1 notes tagged with the BIP hashtag (e.g. #bip110). This is the
 * convention our own opinion events use, and it also catches organic
 * discussion from people who tag their posts. Tune relays/tags from the
 * research report in docs/.
 */
import { SimplePool, type Event } from "nostr-tools";
import { DEFAULT_RELAYS, NOSTR_KINDS, bipHashtag } from "@soft-fork-wiki/shared";

export interface FetchOptions {
  relays?: readonly string[];
  /** Max notes to pull. */
  limit?: number;
  /** Only notes newer than this unix-seconds timestamp. */
  since?: number;
}

export async function fetchBipNotes(
  bipNumber: number,
  opts: FetchOptions = {},
): Promise<Event[]> {
  const relays = [...(opts.relays ?? DEFAULT_RELAYS)];
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(relays, {
      kinds: [NOSTR_KINDS.TEXT_NOTE],
      "#t": [bipHashtag(bipNumber)],
      limit: opts.limit ?? 200,
      since: opts.since,
    });
    // Deduplicate by id (relays can return overlaps) and drop empties.
    const seen = new Set<string>();
    return events.filter((e) => {
      if (seen.has(e.id) || !e.content.trim()) return false;
      seen.add(e.id);
      return true;
    });
  } finally {
    pool.close(relays);
  }
}
