/**
 * Aggregate classified notes into a SentimentSummary, with an LLM narrative.
 */
import type { ClassifiedNote, SentimentSummary } from "@soft-fork-wiki/shared";
import type { SentimentClassifier } from "./providers/index.js";

export interface SummarizeOptions {
  bipTitle?: string;
  /** Unix seconds for the computedAt stamp (caller supplies for testability). */
  computedAt: number;
}

export async function summarizeSentiment(
  classifier: SentimentClassifier,
  bipNumber: number,
  notes: ClassifiedNote[],
  opts: SummarizeOptions,
): Promise<SentimentSummary> {
  let favour = 0;
  let against = 0;
  let neutral = 0;
  for (const n of notes) {
    if (n.stance === "favour") favour++;
    else if (n.stance === "against") against++;
    else neutral++;
  }

  const sided = favour + against;
  const netScore = sided === 0 ? 0 : (favour - against) / sided;

  // Ground the narrative in the strongest-signal notes.
  const sampleNotes = [...notes]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8)
    .map((n) => n.content);

  let narrative = "";
  if (notes.length > 0) {
    try {
      narrative = await classifier.summarize({
        bipNumber,
        bipTitle: opts.bipTitle,
        favour,
        against,
        neutral,
        sampleNotes,
      });
    } catch (err) {
      console.warn("summary generation failed:", err);
    }
  }

  return {
    bipNumber,
    sampleSize: notes.length,
    favour,
    against,
    neutral,
    netScore,
    narrative,
    computedAt: opts.computedAt,
  };
}
