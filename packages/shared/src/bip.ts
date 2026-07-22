/** A Bitcoin Improvement Proposal, as surfaced to users. */
export interface Bip {
  /** BIP number, e.g. 110. Primary identifier across the app. */
  number: number;
  /** Official title, e.g. "Codeword-based Merkle Tree Leaves". */
  title: string;
  /** BIP status, per BIP-2. */
  status: BipStatus;
  /** BIP type, per BIP-2. */
  type: BipType;
  /** Author names / handles as listed in the BIP header. */
  authors?: string[];
  /** Plain-language explanation produced by the LLM explainer (backend). */
  plainSummary?: string;
  /** Link to the canonical BIP text. */
  sourceUrl?: string;
}

export type BipStatus =
  | "Draft"
  | "Proposed"
  | "Active"
  | "Final"
  | "Replaced"
  | "Rejected"
  | "Withdrawn"
  | "Deferred"
  | "Obsolete";

export type BipType = "Standards Track" | "Informational" | "Process";

/** Canonical hashtag used to find/tag Nostr discussion about a BIP. */
export function bipHashtag(bipNumber: number): string {
  return `bip${bipNumber}`;
}
