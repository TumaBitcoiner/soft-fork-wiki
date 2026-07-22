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
 * Bitcoin/protocol discussion. Tune from the research report.
 */
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
  "wss://relay.primal.net",
] as const;

/**
 * App-specific "t" tag applied to every opinion/vote event we publish, so we
 * can query only opinions captured through soft-fork-wiki.
 */
export const APP_TAG = "softforkwiki";
