/**
 * Aggregate a stream of opinions (poll + zap sourced) into an OpinionTally.
 */
import type { Opinion, OpinionTally } from "@soft-fork-wiki/shared";

export function tallyOpinions(
  bipNumber: number,
  opinions: Opinion[],
): OpinionTally {
  const forBip = opinions.filter((o) => o.bipNumber === bipNumber);

  const voters = new Set<string>();
  let favour = 0;
  let against = 0;
  let neutral = 0;
  let zappedMsat = 0;

  for (const o of forBip) {
    voters.add(o.pubkey);
    if (o.stance === "favour") favour++;
    else if (o.stance === "against") against++;
    else neutral++;

    if (o.source === "zap") zappedMsat += o.amountMsat ?? 0;
  }

  return {
    bipNumber,
    favour,
    against,
    neutral,
    uniqueVoters: voters.size,
    zappedSats: Math.floor(zappedMsat / 1000),
  };
}
