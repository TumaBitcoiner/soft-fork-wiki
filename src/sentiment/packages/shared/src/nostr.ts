/**
 * Nostr constants shared across packages.
 *
 * Event kinds and NIP references we rely on. Confirm/expand from the research
 * report in docs/ before locking in the zap-to-vote and poll flows.
 */

export const NOSTR_KINDS = {
  /** NIP-01 short text note — the bulk of BIP discussion. */
  TEXT_NOTE: 1,
  /** NIP-25 reaction (e.g. "+"/"-") — lightweight favour/against signal. */
  REACTION: 7,
  /** NIP-23 long-form content — deeper BIP write-ups. */
  LONG_FORM: 30023,
  /** NIP-57 zap request (client -> LNURL server). */
  ZAP_REQUEST: 9734,
  /** NIP-57 zap receipt (published by the LN server after payment). */
  ZAP_RECEIPT: 9735,
  /** NIP-88 poll. */
  POLL: 1068,
  /** NIP-88 poll response. */
  POLL_RESPONSE: 1018,
} as const;

export type NostrKind = (typeof NOSTR_KINDS)[keyof typeof NOSTR_KINDS];

/**
 * Relays to publish to and read from. General-purpose relays that carry
 * Bitcoin/protocol discussion.
 *
 * Every entry here was probed live before being kept: each must return events
 * for a plain `{kinds:[1], limit:5}` query. `wss://relay.nostr.band` used to be
 * in this list and was removed — it returned ZERO events for every filter we
 * tried (plain, `#t`, long-form), so it silently shrank our relay set from four
 * to three. `wss://nostr.wine` replaces it: it answers plain and `#t` queries
 * and additionally implements NIP-50 search.
 *
 * Coverage is uneven and that is expected — `nos.lol` carries the bulk of `#t`
 * indexed BIP discussion, `relay.damus.io` answers plain queries but returned
 * nothing for `#t` lookups in our probes. We query all of them and dedupe
 * rather than betting on one.
 */
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://nostr.wine",
] as const;

/**
 * Relays that actually implement NIP-50 (the `search` filter field).
 *
 * This list is deliberately SEPARATE from `DEFAULT_RELAYS` and must never be
 * merged into it. A relay that does not implement NIP-50 is permitted by the
 * spec to ignore the unknown `search` field and answer the rest of the filter,
 * which means it happily returns a pile of unrelated recent notes instead of an
 * error. That would silently poison the sample with events that have nothing to
 * do with the BIP. Sending search filters only to relays on this list is the
 * only safe option.
 *
 * Capability was verified with a two-sided probe, not by reading NIP-11:
 *  1. a real term (`search: "drivechain"`) must return a plausible number of
 *     on-topic events, and
 *  2. a nonsense term (`search: "zzqqxjfluffernutterxyzzy"`) must return ZERO.
 *
 * Test (2) is what matters. `wss://relay.snort.social` passes (1) with 50 hits
 * and fails (2) with 20 hits for the nonsense term — it is ignoring `search`
 * entirely, and would have been the exact poisoning failure described above.
 * `wss://relay.primal.net` rejects the filter outright (`NOTICE ... bad req:
 * unrecognised filter item`) and `wss://relay.noswhere.com` returned nothing at
 * all; neither belongs here.
 *
 * Note `wss://search.nos.today` is search-ONLY: a plain query with no `search`
 * field returns zero events from it, which is why it is not in DEFAULT_RELAYS.
 */
export const SEARCH_RELAYS = [
  "wss://search.nos.today",
  "wss://nostr.wine",
] as const;

/**
 * App-specific "t" tag applied to every opinion/vote event we publish, so we
 * can query only opinions captured through soft-fork-wiki.
 */
export const APP_TAG = "softforkwiki";
