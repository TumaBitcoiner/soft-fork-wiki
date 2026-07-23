/**
 * A user's stated opinion on a BIP.
 *
 * Captured by the voting package. Two mechanisms feed this:
 *  - an explicit poll-style response (favour / against / neutral), and
 *  - a "zap-to-vote" Lightning payment that signals support.
 */

export type Stance = "favour" | "against" | "neutral";

export interface Opinion {
  /** BIP this opinion is about. */
  bipNumber: number;
  /** Nostr pubkey (hex) of the person expressing the opinion. */
  pubkey: string;
  /** The stated stance. */
  stance: Stance;
  /** How the opinion was captured. */
  source: OpinionSource;
  /** For zap-sourced opinions: amount in millisats. */
  amountMsat?: number;
  /** Nostr event id backing this opinion (poll response or zap receipt). */
  eventId?: string;
  /** Unix seconds. */
  createdAt: number;
}

export type OpinionSource = "poll" | "zap" | "reaction";

/** Aggregated tally for a BIP, ready for the analytics dashboard. */
export interface OpinionTally {
  bipNumber: number;
  favour: number;
  against: number;
  neutral: number;
  /** Distinct pubkeys that expressed any opinion. */
  uniqueVoters: number;
  /** Sats zapped to the FOR anchor. */
  zappedSatsFavour: number;
  /** Sats zapped to the AGAINST anchor. */
  zappedSatsAgainst: number;
}
