import type { SentimentClassifier } from "./types.js";
import { ClaudeClassifier } from "./claude.js";
import { GeminiClassifier } from "./gemini.js";

export * from "./types.js";
export { ClaudeClassifier } from "./claude.js";
export { GeminiClassifier } from "./gemini.js";

export type ProviderName = "claude" | "gemini";

/** Build a classifier by name. Defaults to SENTIMENT_PROVIDER, else claude. */
export function makeClassifier(
  name: ProviderName = (process.env.SENTIMENT_PROVIDER as ProviderName) ?? "claude",
): SentimentClassifier {
  switch (name) {
    case "gemini":
      return new GeminiClassifier();
    case "claude":
      return new ClaudeClassifier();
    default:
      throw new Error(`Unknown sentiment provider: ${name}`);
  }
}
