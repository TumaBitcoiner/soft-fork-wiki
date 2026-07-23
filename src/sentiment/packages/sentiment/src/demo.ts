/**
 * Analyze one BIP end to end.
 *   SENTIMENT_PROVIDER=claude pnpm --filter @soft-fork-wiki/sentiment dev 110
 *   SENTIMENT_PROVIDER=gemini pnpm --filter @soft-fork-wiki/sentiment dev 110
 */
import { analyzeBip } from "./pipeline.js";
import type { ProviderName } from "./providers/index.js";

const bipNumber = Number(process.argv[2] ?? 110);
const provider = process.env.SENTIMENT_PROVIDER as ProviderName | undefined;

console.log(
  `Analyzing BIP ${bipNumber} via ${provider ?? "claude"} — fetching Nostr notes...`,
);

const summary = await analyzeBip(bipNumber, {
  provider,
  limit: 100,
  computedAt: Math.floor(Date.now() / 1000),
});

console.log("\n=== Sentiment for BIP", bipNumber, "===");
console.log(`sample size : ${summary.sampleSize} notes`);
console.log(`favour      : ${summary.favour}`);
console.log(`against     : ${summary.against}`);
console.log(`neutral     : ${summary.neutral}`);
console.log(`net score   : ${summary.netScore.toFixed(2)}  (-1 against .. +1 favour)`);
console.log(`\n${summary.narrative || "(no notes found to summarize)"}`);
