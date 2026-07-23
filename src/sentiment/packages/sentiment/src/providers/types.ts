import type { Stance } from "@soft-fork-wiki/shared";

/** Result of classifying one note's stance toward a BIP. */
export interface StanceResult {
  stance: Stance;
  /** 0..1 confidence. */
  confidence: number;
  /** One-line rationale (surfaced in the UI for transparency). */
  rationale: string;
}

/**
 * A pluggable sentiment backend. Both Claude and Gemini Flash implement this,
 * so the pipeline is provider-agnostic and results are directly comparable.
 */
export interface SentimentClassifier {
  /** Human-readable id, e.g. "claude" or "gemini". */
  readonly name: string;

  /** Classify a single note's stance toward the given BIP. */
  classifyNote(input: ClassifyInput): Promise<StanceResult>;

  /** Write a one-paragraph plain-language summary of the network's stance. */
  summarize(input: SummarizeInput): Promise<string>;
}

export interface ClassifyInput {
  bipNumber: number;
  /** Optional BIP title for context. */
  bipTitle?: string;
  noteContent: string;
}

export interface SummarizeInput {
  bipNumber: number;
  bipTitle?: string;
  favour: number;
  against: number;
  neutral: number;
  /** A few representative note excerpts, to ground the summary. */
  sampleNotes: string[];
}
