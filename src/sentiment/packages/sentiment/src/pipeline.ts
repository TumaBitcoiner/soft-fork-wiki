/**
 * End-to-end: fetch -> classify -> summarize for one BIP.
 */
import type { SentimentSummary } from "@soft-fork-wiki/shared";
import { fetchBipNotes, type FetchOptions } from "./fetch.js";
import { classifyNotes } from "./classify.js";
import { summarizeSentiment } from "./summarize.js";
import { makeClassifier, type ProviderName } from "./providers/index.js";

export interface AnalyzeOptions extends FetchOptions {
  provider?: ProviderName;
  bipTitle?: string;
  /** Unix seconds stamp for the result. */
  computedAt: number;
}

export async function analyzeBip(
  bipNumber: number,
  opts: AnalyzeOptions,
): Promise<SentimentSummary> {
  const classifier = makeClassifier(opts.provider);
  const notes = await fetchBipNotes(bipNumber, opts);
  const classified = await classifyNotes(
    classifier,
    bipNumber,
    notes,
    opts.bipTitle,
  );
  return summarizeSentiment(classifier, bipNumber, classified, {
    bipTitle: opts.bipTitle,
    computedAt: opts.computedAt,
  });
}
