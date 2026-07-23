/**
 * Sentiment analysis over public Nostr discussion of a BIP.
 * Produced by the sentiment package.
 */

import type { Stance } from "./opinion.js";

/** A single Nostr note that mentions a BIP, plus its classified stance. */
export interface ClassifiedNote {
  /** Nostr event id. */
  eventId: string;
  /** Author pubkey (hex). */
  pubkey: string;
  /** Raw note content. */
  content: string;
  /** Unix seconds. */
  createdAt: number;
  /** LLM-classified stance toward the BIP. */
  stance: Stance;
  /** 0..1 confidence from the classifier. */
  confidence: number;
  /** One-line rationale from the classifier (for transparency in the UI). */
  rationale?: string;
}

/** Network-level sentiment summary for one BIP. */
export interface SentimentSummary {
  bipNumber: number;
  /** Count of notes analyzed. */
  sampleSize: number;
  favour: number;
  against: number;
  neutral: number;
  /** -1 (all against) .. +1 (all in favour). */
  netScore: number;
  /** Short LLM-written synthesis: "what the network thinks about BIP N". */
  narrative?: string;
  /** When this summary was computed (unix seconds). */
  computedAt: number;
}
